/**
 * @jest-environment node
 */
import { encodeAbiParameters, pad, parseAbiParameters, toHex, type Hex } from "viem";

import { MODIFY_LIQUIDITY_TOPIC } from "../pools/rpc/abi";
import { DAY, dayStart } from "../pools/rpc/buckets";
import { chainConfig, rpcPoolsFor } from "../pools/registry";
import { cursorKey, dayKey, positionsKey, stateKey, type RpcRedis } from "../pools/rpc/store";
import { memoryRedis } from "../pools/testing";
import { positionHistory, type BlockPrices, type HistoryClient } from "./history";
import type { PositionRewards } from "./rewards";

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

const OWNER = "0x00000000000000000000000000000000000000aa";

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

type FakeOptions = {
  logs?: ReturnType<typeof modifyLog>[];
  logsFail?: boolean;
  liquidity?: bigint;
  poolId?: string;
  missing?: boolean;
  /** The pool's sqrt price now and at every archive read; 1:1 by default. */
  sqrtNow?: bigint;
};

function fakeClient({ logs = [], logsFail = false, liquidity = LIQUIDITY, poolId = pool.id, missing = false, sqrtNow = Q96 }: FakeOptions = {}) {
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
          case "ownerOf":
            return { status: "success" as const, result: OWNER };
          case "getSlot0":
            return { status: "success" as const, result: [sqrtNow, sqrtNow === Q96 ? 0 : Math.round(Math.log(Number(sqrtNow) / Number(Q96)) / Math.log(Math.sqrt(1.0001))), 0, 3000] };
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
      return [sqrtNow, 0, 0, 3000];
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

const deps = (
  client: HistoryClient,
  redis: RpcRedis,
  extra: { rewards?: (owner: string) => Promise<PositionRewards | null>; pricedAt?: (block: number) => Promise<BlockPrices | null> } = {},
) => ({ client, redis, positionManager: POSITION_MANAGER, now: () => NOW * 1000, pricedAt: async () => null, ...extra });

/** Token USD prices when the position opened: currency0 at 1 and currency1 at 1.5, with the pool at 1:1. */
const OPEN_PRICES: BlockPrices = { sqrt: Q96, usd0: 1, usd1: 1.5 };

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

  describe("performance", () => {
    const deposit = TODAY - 2 * DAY + 3600;

    it("sets the deposit, valued when it was made, against the value now, the fees and the rewards", async () => {
      const redis = memoryRedis() as unknown as RpcRedis;
      await seed(redis);
      const { client } = fakeClient({ logs: [modifyLog(blockAt(deposit), deposit, LIQUIDITY)] });
      const rewards = jest.fn(async () => ({ symbol: "TEL", token: "", amount: 100, priceUSD: 0.5 }));

      const history = await positionHistory(CHAIN, TOKEN, deps(client, redis, { rewards, pricedAt: async () => OPEN_PRICES }));
      const { performance, deposited, fees } = history!;

      expect(rewards).toHaveBeenCalledWith(OWNER);
      expect(performance.openedAt).toBe(deposit);
      // Latest prices are 2 and 3 against 1 and 1.5 at the open: both tokens doubled.
      expect(performance.priceChange.token0).toEqual({ open: 1, now: 2, change: 1 });
      expect(performance.priceChange.token1).toEqual({ open: 1.5, now: 3, change: 1 });
      expect(performance.depositedUSD).toBeCloseTo(deposited!.amount0 * 1 + deposited!.amount1 * 1.5, 9);
      expect(performance.withdrawnUSD).toBe(0);
      // The pool price never moved, so the position holds exactly what was deposited: no impermanent loss.
      expect(performance.impermanentLoss).toBeCloseTo(0, 9);
      expect(performance.rewards).toEqual({ amount: 100, symbol: "TEL", usd: 50 });
      expect(performance.feesAndRewardsUSD).toBeCloseTo(fees!.usd! + 50, 9);
      const pnlUSD = performance.valueUSD! + fees!.usd! + 50 - performance.depositedUSD!;
      expect(performance.pnlUSD).toBeCloseTo(pnlUSD, 9);
      expect(performance.pnl).toBeCloseTo(pnlUSD / performance.depositedUSD!, 9);
    });

    it("prices rewards at the pipeline's latest price for the reward token when it has one", async () => {
      const redis = memoryRedis() as unknown as RpcRedis;
      await seed(redis);
      const { client } = fakeClient({ logs: [modifyLog(blockAt(deposit), deposit, LIQUIDITY)] });
      const token = pool.key.currency1.toLowerCase();

      const history = await positionHistory(CHAIN, TOKEN, deps(client, redis, { rewards: async () => ({ symbol: "TEL", token, amount: 10, priceUSD: 0.5 }), pricedAt: async () => OPEN_PRICES }));

      expect(history!.performance.rewards).toEqual({ amount: 10, symbol: "TEL", usd: 30 });
    });

    it("counts a withdrawal at its own prices and keeps it in the P&L", async () => {
      const redis = memoryRedis() as unknown as RpcRedis;
      await seed(redis);
      const withdrawal = TODAY - DAY + 3600;
      const { client } = fakeClient({
        liquidity: LIQUIDITY / 2n,
        logs: [modifyLog(blockAt(deposit), deposit, LIQUIDITY), modifyLog(blockAt(withdrawal), withdrawal, -LIQUIDITY / 2n)],
      });
      const prices = new Map<number, BlockPrices>([
        [blockAt(deposit), OPEN_PRICES],
        [blockAt(withdrawal), { sqrt: Q96, usd0: 4, usd1: 4 }],
      ]);

      const history = await positionHistory(CHAIN, TOKEN, deps(client, redis, { pricedAt: async block => prices.get(block) ?? null }));
      const { performance, deposited } = history!;

      // Half the liquidity came out at 4 USD a token; the other half is still in.
      expect(performance.withdrawnUSD).toBeCloseTo(deposited!.amount0 * 4 + deposited!.amount1 * 4, 9);
      expect(performance.depositedUSD).toBeCloseTo(deposited!.amount0 * 2 * 1 + deposited!.amount1 * 2 * 1.5, 9);
      expect(performance.pnlUSD).toBeCloseTo(performance.valueUSD! + performance.withdrawnUSD! + history!.fees!.usd! - performance.depositedUSD!, 9);
    });

    it("measures impermanent loss when the price has moved away from the deposit", async () => {
      const redis = memoryRedis() as unknown as RpcRedis;
      await redis.hset(cursorKey(CHAIN), { block: HEAD.block, timestamp: HEAD.timestamp, updatedAt: 0, pools: "[]" });
      await redis.hset(stateKey(CHAIN), {
        prices: JSON.stringify({ tokens: { [pool.key.currency0.toLowerCase()]: { usd: 4, source: "feed" }, [pool.key.currency1.toLowerCase()]: { usd: 1, source: "pools" } }, telRoutes: [], impliedEusd: null }),
      });
      // The pool now prices currency0 at 4 of currency1, against 1:1 at the deposit.
      const { client } = fakeClient({ logs: [modifyLog(blockAt(deposit), deposit, LIQUIDITY)], sqrtNow: 2n * Q96 });

      const history = await positionHistory(CHAIN, TOKEN, deps(client, redis, { pricedAt: async () => ({ sqrt: Q96, usd0: 1, usd1: 1 }) }));
      const { impermanentLoss, valueUSD, heldUSD } = history!.performance;

      expect(impermanentLoss).not.toBeNull();
      expect(impermanentLoss!).toBeLessThan(0);
      expect(impermanentLoss).toBeCloseTo(valueUSD! / heldUSD! - 1, 12);
    });

    it("keeps the P&L of a closed position but leaves out impermanent loss, which needs liquidity still in the pool", async () => {
      const redis = memoryRedis() as unknown as RpcRedis;
      await seed(redis);
      const withdrawal = TODAY - DAY + 3600;
      const { client } = fakeClient({
        liquidity: 0n,
        logs: [modifyLog(blockAt(deposit), deposit, LIQUIDITY), modifyLog(blockAt(withdrawal), withdrawal, -LIQUIDITY)],
      });
      const prices = new Map<number, BlockPrices>([
        [blockAt(deposit), OPEN_PRICES],
        [blockAt(withdrawal), { sqrt: Q96, usd0: 2, usd1: 3 }],
      ]);

      const history = await positionHistory(CHAIN, TOKEN, deps(client, redis, { pricedAt: async block => prices.get(block) ?? null }));
      const { performance } = history!;

      expect(performance.valueUSD).toBe(0);
      expect(performance.impermanentLoss).toBeNull();
      // Everything came out at twice the deposit's prices.
      expect(performance.withdrawnUSD).toBeCloseTo(2 * performance.depositedUSD!, 9);
      expect(performance.pnl).toBeCloseTo(1 + history!.fees!.usd! / performance.depositedUSD!, 9);
    });

    it("leaves rewards out of the P&L and says so when Merkl can't be read", async () => {
      const redis = memoryRedis() as unknown as RpcRedis;
      await seed(redis);
      const { client } = fakeClient({ logs: [modifyLog(blockAt(deposit), deposit, LIQUIDITY)] });

      const history = await positionHistory(CHAIN, TOKEN, deps(client, redis, { rewards: async () => Promise.reject(new Error("merkl down")), pricedAt: async () => OPEN_PRICES }));
      const { performance, fees } = history!;

      expect(performance.rewards).toBeNull();
      expect(performance.feesAndRewardsUSD).toBeCloseTo(fees!.usd!, 9);
      expect(performance.pnlUSD).toBeCloseTo(performance.valueUSD! + fees!.usd! - performance.depositedUSD!, 9);
      expect(history!.notes.join(" ")).toMatch(/TELx rewards couldn't be loaded/);
    });

    it("has no money figures when the deposit's prices can't be read, though the price change stays unknown too", async () => {
      const redis = memoryRedis() as unknown as RpcRedis;
      await seed(redis);
      const { client } = fakeClient({ logs: [modifyLog(blockAt(deposit), deposit, LIQUIDITY)] });

      const history = await positionHistory(CHAIN, TOKEN, deps(client, redis));
      const { performance } = history!;

      // The archive price read still places the deposit, so held instead and impermanent loss remain.
      expect(history!.deposited).not.toBeNull();
      expect(performance.impermanentLoss).toBeCloseTo(0, 9);
      expect(performance.depositedUSD).toBeNull();
      expect(performance.pnl).toBeNull();
      expect(performance.priceChange.token0).toEqual({ open: null, now: 2, change: null });
    });
  });

  it("is null for a token outside the registry pools or one that can't be read", async () => {
    const redis = memoryRedis() as unknown as RpcRedis;
    await seed(redis);
    const other = `0x${"ab".repeat(32)}`;
    await expect(positionHistory(CHAIN, TOKEN, deps(fakeClient({ poolId: other }).client, redis))).resolves.toBeNull();
    await expect(positionHistory(CHAIN, TOKEN, deps(fakeClient({ missing: true }).client, redis))).resolves.toBeNull();
  });
});
