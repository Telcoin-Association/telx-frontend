/**
 * @jest-environment node
 */
import { encodeAbiParameters, pad, parseAbiParameters, toHex, type Hex } from "viem";

import { MODIFY_LIQUIDITY_TOPIC } from "../pools/rpc/abi";
import { DAY, dayStart } from "../pools/rpc/buckets";
import { chainConfig, rpcPoolsFor } from "../pools/registry";
import { cursorKey, dayKey, positionsKey, stateKey, type RpcRedis } from "../pools/rpc/store";
import { memoryRedis } from "../pools/testing";
import { positionHistory, type HistoryClient } from "./history";

const CHAIN = "polygon";
const config = chainConfig(CHAIN);
const POSITION_MANAGER = config.contracts.positionManager;
const pool = rpcPoolsFor(CHAIN)[0];
const TOKEN = 42n;
const [TICK_LOWER, TICK_UPPER] = [-600, 600];
const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;
const NOW = 1_790_800_000; // 2026-10-01
const TODAY = dayStart(NOW);
const HEAD = { block: pool.createdBlock + 1_000_000, timestamp: NOW - 60 };
const LIQUIDITY = 10n ** 18n;

const blockAt = (time: number) => HEAD.block - Math.ceil((HEAD.timestamp - time) / config.blockTime);

/** PositionInfo as the PositionManager packs it: 25 bytes of pool id, then tickUpper, tickLower and the subscriber flag. */
const infoWord = (poolId: string) =>
  (BigInt(poolId.slice(0, 52)) << 56n) | (BigInt(TICK_UPPER & 0xffffff) << 32n) | (BigInt(TICK_LOWER & 0xffffff) << 8n);

function modifyLog(block: number, time: number, delta: bigint, tokenId = TOKEN) {
  return {
    address: config.contracts.poolManager,
    blockNumber: toHex(block),
    blockHash: pad("0x", { size: 32 }),
    blockTimestamp: toHex(time),
    transactionHash: pad(toHex(block), { size: 32 }),
    logIndex: "0x0",
    data: encodeAbiParameters(parseAbiParameters("int24, int24, int256, bytes32"), [TICK_LOWER, TICK_UPPER, delta, pad(toHex(tokenId), { size: 32 })]),
    topics: [MODIFY_LIQUIDITY_TOPIC, pool.id as Hex, pad(POSITION_MANAGER as Hex, { size: 32 })],
    removed: false,
  };
}

type FakeOptions = { logs?: ReturnType<typeof modifyLog>[]; logsFail?: boolean; liquidity?: bigint; poolId?: string; missing?: boolean };

function fakeClient({ logs = [], logsFail = false, liquidity = LIQUIDITY, poolId = pool.id, missing = false }: FakeOptions = {}) {
  const archive: bigint[] = [];
  const client: HistoryClient = {
    request: jest.fn(async ({ method }: { method: string }) => {
      if (method === "eth_getLogs") {
        if (logsFail) throw new Error("logs down");
        return logs;
      }
      if (method === "eth_blockNumber") return toHex(HEAD.block);
      throw new Error(`unexpected ${method}`);
    }) as never,
    multicall: jest.fn(async ({ contracts }: { contracts: readonly { functionName: string }[] }) =>
      contracts.map(({ functionName }) => {
        if (missing) return { status: "failure" as const, error: new Error("nonexistent token") };
        switch (functionName) {
          case "positionInfo":
            return { status: "success" as const, result: infoWord(poolId) };
          case "getPositionLiquidity":
            return { status: "success" as const, result: liquidity };
          case "getSlot0":
            return { status: "success" as const, result: [Q96, 0, 0, 3000] };
          case "getPositionInfo":
            return { status: "success" as const, result: [liquidity, 0n, 0n] };
          case "getFeeGrowthInside":
            // 2e-18 of currency0 and 4e-18 of currency1 owed per unit of liquidity.
            return { status: "success" as const, result: [2n * Q128 / 10n ** 18n, 4n * Q128 / 10n ** 18n] };
          default:
            throw new Error(`unexpected ${functionName}`);
        }
      }),
    ) as never,
    readContract: jest.fn(async ({ blockNumber }: { blockNumber?: bigint }) => {
      archive.push(blockNumber ?? -1n);
      return [Q96, 0, 0, 3000];
    }) as never,
  };
  return { client, archive };
}

async function seed(redis: RpcRedis) {
  await redis.hset(cursorKey(CHAIN), { block: HEAD.block, timestamp: HEAD.timestamp, updatedAt: 0, pools: "[]" });
  await redis.hset(stateKey(CHAIN), {
    prices: JSON.stringify({ tokens: { [pool.key.currency0.toLowerCase()]: { usd: 2, source: "feed" }, [pool.key.currency1.toLowerCase()]: { usd: 3, source: "pools" } }, telRoutes: [], impliedEusd: null }),
  });
  // Yesterday's row carries its closing price; the day before it was written before the price fields existed.
  await redis.hset(dayKey(CHAIN, pool.id), {
    [TODAY - DAY]: JSON.stringify({ swaps: 0, volumeUSD: 0, feesUSD: 0, lpFeesUSD: 0, tvlUSD: 1, sqrtPriceX96: Q96.toString(), tick: 0, price0USD: 4, price1USD: 5 }),
    [TODAY - 2 * DAY]: JSON.stringify({ swaps: 0, volumeUSD: 0, feesUSD: 0, lpFeesUSD: 0, tvlUSD: 1 }),
  });
}

const deps = (client: HistoryClient, redis: RpcRedis) => ({ client, redis, positionManager: POSITION_MANAGER, now: () => NOW * 1000 });

describe("positionHistory", () => {
  it("builds the position's days, value against held instead, time in range and uncollected fees", async () => {
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis);
    const deposit = TODAY - 2 * DAY + 3600;
    const { client } = fakeClient({ logs: [modifyLog(blockAt(deposit), deposit, LIQUIDITY)] });

    const history = await positionHistory(CHAIN, TOKEN, deps(client, redis));

    expect(history).toMatchObject({ poolId: pool.id, tokenId: "42", tickLower: TICK_LOWER, tickUpper: TICK_UPPER, changesFrom: "logs", inRange: true });
    expect(history!.days.map(day => day.day)).toEqual([TODAY - 2 * DAY, TODAY - DAY, TODAY]);
    expect(history!.days.map(day => day.pricedWith)).toEqual(["latest", "stored", "latest"]);
    expect(history!.days.every(day => day.liquidity === LIQUIDITY.toString() && day.inRange === true)).toBe(true);
    // At the pool price of 1 the amounts equal the deposit, so value and held-instead agree on each day.
    const stored = history!.days[1];
    expect(stored.valueUSD).toBeCloseTo(stored.heldUSD!, 6);
    expect(stored.valueUSD).toBeGreaterThan(0);
    expect(history!.timeInRange).toEqual({ days: 3, inRangeDays: 3 });
    expect(history!.fees!.usd).toBeCloseTo(history!.fees!.amount0 * 2 + history!.fees!.amount1 * 3, 12);
    expect(history!.fees!.amount0).toBeGreaterThan(0);
    expect(history!.historyFrom).toBe(TODAY - 2 * DAY);
    expect(history!.notes.join(" ")).toMatch(/valued at today's token prices/);
  });

  it("falls back to the pipeline's stored changes when the logs fail, and says so", async () => {
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis);
    const deposit = TODAY - DAY + 60;
    await redis.hset(positionsKey(CHAIN, pool.id), {
      [`42:${blockAt(deposit)}:0`]: JSON.stringify({ t: deposit, tickLower: TICK_LOWER, tickUpper: TICK_UPPER, d: LIQUIDITY.toString() }),
    });
    const { client } = fakeClient({ logsFail: true });

    const history = await positionHistory(CHAIN, TOKEN, deps(client, redis));

    expect(history!.changesFrom).toBe("stored");
    expect(history!.days.map(day => day.day)).toEqual([TODAY - DAY, TODAY]);
    expect(history!.notes.join(" ")).toMatch(/earlier history couldn't be loaded/);
  });

  it("leaves out held instead when the changes don't add up to the current liquidity", async () => {
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis);
    const { client } = fakeClient({ logs: [] });

    const history = await positionHistory(CHAIN, TOKEN, deps(client, redis));

    expect(history!.deposited).toBeNull();
    expect(history!.days.every(day => day.heldUSD === null)).toBe(true);
    expect(history!.notes.join(" ")).toMatch(/history is missing/);
  });

  it("is null for a token outside the registry pools or one that can't be read", async () => {
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis);
    const other = `0x${"ab".repeat(32)}`;
    await expect(positionHistory(CHAIN, TOKEN, deps(fakeClient({ poolId: other }).client, redis))).resolves.toBeNull();
    await expect(positionHistory(CHAIN, TOKEN, deps(fakeClient({ missing: true }).client, redis))).resolves.toBeNull();
  });
});
