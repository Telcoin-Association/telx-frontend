/**
 * @jest-environment node
 */
import { encodeAbiParameters, encodeFunctionResult, pad, parseAbiParameters, toHex, type Hex } from "viem";

import type { RawLog } from "@/server/chain/logs";

import { rpcPoolsFor } from "../registry";
import { memoryRedis } from "../testing";
import { CHAINLINK_FEED_ABI, MODIFY_LIQUIDITY_TOPIC, MULTICALL3_ABI, RESERVES_LENS_ABI, STATE_VIEW_ABI, SWAP_TOPIC } from "./abi";
import { HOUR, HOUR_RETENTION, type StoredHour } from "./buckets";
import { CHAINS, type ChainConfig } from "./chains";
import {
  backfillWindow,
  closingBlock,
  liquidityAt,
  missingHours,
  runHourBackfill,
  runHourBackfillJob,
  type HourBackfillDeps,
  type HourBackfillRedis,
} from "./hourBackfill";
import type { PoolEvent } from "./logs";
import { cursorKey, encodeLiquidity, hourKey, liquidityKey, lockKey, stateKey } from "./store";

jest.mock("../redis", () => ({ getRedis: () => null }));

const config: ChainConfig = { ...CHAINS.polygon, blockTime: 2, maxBlocksPerChunk: 21_600 };
const pools = rpcPoolsFor("polygon");
const [WETH_TEL, EUSD_TEL, EUSD_EMXN] = ["0xa22a3fb3", "0x1266df87", "0xe604df8f"].map(prefix => pools.find(pool => pool.id.startsWith(prefix))!);
const FIRST = Math.min(...pools.map(pool => pool.createdBlock));
const T0 = 1_790_121_600; // 00:00 UTC; the pools are created at this time
const BLOCKS_PER_HOUR = HOUR / 2;
const timeOf = (block: number) => T0 + (block - FIRST) * 2;
const blockAt = (hours: number, offset = 0) => FIRST + hours * BLOCKS_PER_HOUR + offset;
const hour = (n: number) => T0 + n * HOUR;
/** The cursor sits 10 minutes into hour 10, so hours 0 to 9 are the backfill's. */
const CURSOR = blockAt(10, 300);
const NOW_MS = (timeOf(CURSOR) + 300) * 1000;
const ZERO = pad("0x", { size: 32 });
const Q96 = 2n ** 96n;
const RANGE = "-600:600";
const LIQUIDITY = 10n ** 20n;

const SQRT_PRICES: Record<string, bigint> = {
  [WETH_TEL.id]: 1000n * Q96, // 1,000,000 TEL per WETH
  [EUSD_TEL.id]: 22_360_679n * Q96, // about 500 TEL per eUSD (18 - 6 decimals)
  [EUSD_EMXN.id]: (424_264n * Q96) / 100_000n, // 18 eMXN per eUSD
};

function swapLog(block: number, logIndex: number, poolId: string, amount0: bigint, amount1: bigint): RawLog {
  return {
    address: config.contracts.poolManager,
    blockNumber: toHex(block),
    blockHash: ZERO,
    blockTimestamp: toHex(timeOf(block)),
    transactionHash: pad(toHex(block * 100 + logIndex), { size: 32 }),
    logIndex: toHex(logIndex),
    data: encodeAbiParameters(parseAbiParameters("int128, int128, uint160, uint128, int24, uint24"), [
      amount0,
      amount1,
      SQRT_PRICES[poolId],
      1n,
      0,
      3499,
    ]),
    topics: [SWAP_TOPIC, poolId as Hex, ZERO],
    removed: false,
  };
}

function liquidityLog(block: number, poolId: string, delta: bigint): RawLog {
  return {
    ...swapLog(block, 0, poolId, 0n, 0n),
    data: encodeAbiParameters(parseAbiParameters("int24, int24, int256, bytes32"), [-600, 600, delta, ZERO]),
    topics: [MODIFY_LIQUIDITY_TOPIC, poolId as Hex, ZERO],
  };
}

const LOGS = [
  liquidityLog(blockAt(5, 100), WETH_TEL.id, LIQUIDITY),
  swapLog(blockAt(8, 5), 0, EUSD_TEL.id, -(100n * 10n ** 6n), 49_825n * 10n ** 18n), // 100 eUSD in
  swapLog(blockAt(9, 10), 0, WETH_TEL.id, -(10n ** 18n), 996_501n * 10n ** 18n), // 1 WETH in
  swapLog(blockAt(10, 50), 0, WETH_TEL.id, -(10n ** 18n), 996_501n * 10n ** 18n), // in the cursor's hour, which the cron owns
];

/** A fake archive node over `logs`. `noLens` fails that pool's ReservesLens call, so its TVL comes from the position sum. */
function fakeChain(logs: RawLog[], options: { noLens?: string } = {}) {
  const calls: Record<string, number> = {};
  const lens = (amount0: bigint, amount1: bigint) =>
    encodeFunctionResult({
      abi: RESERVES_LENS_ABI,
      functionName: "getPoolTVL",
      result: {
        coreAmount0: amount0,
        coreAmount1: amount1,
        hookReserves0: 0n,
        hookReserves1: 0n,
        hookEffective0: 0n,
        hookEffective1: 0n,
        sqrtPriceX96: Q96,
        tick: 0,
        activeLiquidity: 1n,
        blockNumber: 0n,
        statsProvider: "0x0000000000000000000000000000000000000000",
        hookPermissions: 0,
        hasCustomAccounting: false,
        statsStatus: 0,
      },
    });
  const ok = (returnData: Hex) => ({ success: true, returnData });
  const failed = { success: false, returnData: "0x" as Hex };
  const bundle = (block: number) => [
    ok(encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getBlockNumber", result: BigInt(block) })),
    ok(encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getCurrentBlockTimestamp", result: BigInt(timeOf(block)) })),
    ok(
      encodeFunctionResult({
        abi: CHAINLINK_FEED_ABI,
        functionName: "latestRoundData",
        result: [1n, 2000n * 10n ** 8n, 0n, BigInt(timeOf(block)), 1n],
      }),
    ),
    ok(encodeFunctionResult({ abi: CHAINLINK_FEED_ABI, functionName: "latestRoundData", result: [1n, 5_555_556n, 0n, BigInt(timeOf(block)), 1n] })),
    ...pools.flatMap(pool => [
      pool.id === options.noLens
        ? failed
        : ok(lens(pool.id === EUSD_EMXN.id ? 10n ** 9n : 10n ** 10n * (pool.id === WETH_TEL.id ? 10n ** 9n : 1n), 10n ** 24n)),
      ok(encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getSlot0", result: [SQRT_PRICES[pool.id], 0, 0, 3000] })),
      ok(encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getLiquidity", result: 1n })),
    ]),
  ];
  const request = jest.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    calls[method] = (calls[method] ?? 0) + 1;
    const args = params as unknown[];
    if (method === "eth_call") {
      const [, tag] = args as [{ data: Hex }, string];
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: bundle(Number.parseInt(tag, 16)) });
    }
    if (method === "eth_getLogs") {
      const [{ fromBlock, toBlock }] = args as [{ fromBlock: Hex; toBlock: Hex }];
      const [from, to] = [Number.parseInt(fromBlock, 16), Number.parseInt(toBlock, 16)];
      return logs.filter(log => Number.parseInt(log.blockNumber, 16) >= from && Number.parseInt(log.blockNumber, 16) <= to);
    }
    if (method === "eth_getBlockByNumber") return { timestamp: toHex(timeOf(Number.parseInt((args as [Hex])[0], 16))) };
    throw new Error(`unexpected ${method}`);
  });
  return { client: { request }, calls, request };
}

let kv = memoryRedis();

/** A chain the RPC backfill has run on: the cursor in hour 10, every pool created at T0, and the WETH/TEL range at the cursor. */
async function seed() {
  kv = memoryRedis();
  const ids = JSON.stringify(pools.map(pool => pool.id).sort());
  await kv.hset(cursorKey("polygon"), { block: CURSOR, timestamp: timeOf(CURSOR), updatedAt: 0, pools: ids });
  await kv.hset(stateKey("polygon"), Object.fromEntries(pools.map(pool => [`pool:${pool.id}`, JSON.stringify({ createdAt: T0 })])));
  await kv.hset(liquidityKey("polygon", WETH_TEL.id), { [RANGE]: encodeLiquidity(LIQUIDITY) });
}

const STORED: StoredHour = { swaps: 99, volumeUSD: 1, feesUSD: 1, tvlUSD: 1, sqrtPriceX96: "1", tick: 1, price0USD: 1, price1USD: 1 };

function deps(client: HourBackfillDeps["client"], extra: Partial<HourBackfillDeps> = {}): HourBackfillDeps {
  return { client, redis: kv as unknown as HourBackfillRedis, now: () => NOW_MS, config, pools, polygonPools: pools, budgetMs: 120_000, ...extra };
}

const rowOf = async (poolId: string, n: number) => (await kv.hgetall<Record<string, StoredHour>>(hourKey("polygon", poolId)))?.[String(hour(n))];

beforeEach(async () => {
  await seed();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("backfillWindow", () => {
  it("spans the retention window up to the hour before the cursor's, and below `before` when given", () => {
    const now = hour(40) + 120;
    expect(backfillWindow(now, hour(10) + 600)).toEqual({ first: hour(41) - HOUR_RETENTION, last: hour(9) });
    expect(backfillWindow(now, hour(10) + 600, hour(6))).toEqual({ first: hour(41) - HOUR_RETENTION, last: hour(5) });
    expect(backfillWindow(now, hour(10) + 600, hour(20))).toMatchObject({ last: hour(9) });
  });
});

describe("missingHours", () => {
  it("lists the hours where a pool created by the hour's end has no row, newest first, with the pools missing each", () => {
    const missing = missingHours(
      [
        { id: "a", createdAt: null, stored: new Set([hour(1), hour(3)]) },
        { id: "b", createdAt: hour(2) + 1_800, stored: new Set() }, // created halfway through hour 2
        { id: "c", createdAt: hour(0), stored: new Set([hour(0), hour(1), hour(2), hour(3)]) },
      ],
      hour(0),
      hour(3),
    );
    expect(missing.hours).toEqual([hour(3), hour(2), hour(0)]);
    expect(Object.fromEntries(missing.pools)).toEqual({ [hour(3)]: ["b"], [hour(2)]: ["a", "b"], [hour(0)]: ["a"] });
    expect(missing).toMatchObject({ rows: 4, hoursInWindow: 4 });
  });

  it("finds nothing when every row is stored, or the window is empty", () => {
    const pool = { id: "a", createdAt: hour(0), stored: new Set([hour(0), hour(1)]) };
    expect(missingHours([pool], hour(0), hour(1))).toMatchObject({ hours: [], rows: 0, hoursInWindow: 2 });
    expect(missingHours([pool], hour(2), hour(1))).toMatchObject({ hours: [], rows: 0, hoursInWindow: 0 });
  });
});

describe("closingBlock", () => {
  it("finds the last block before the hour ends, from a block well above it", async () => {
    const seen = jest.fn(async (block: number) => timeOf(block));
    for (const n of [9, 4, 0]) {
      expect(await closingBlock(seen, hour(n), { block: CURSOR, timestamp: timeOf(CURSOR) }, 2)).toEqual({
        block: blockAt(n + 1) - 1,
        timestamp: hour(n + 1) - 2,
      });
    }
  });

  it("finds it when blocks come slower than the block time says", async () => {
    const slow = async (block: number) => T0 + (block - FIRST) * 3;
    const upper = { block: FIRST + 20_000, timestamp: await slow(FIRST + 20_000) };
    const found = await closingBlock(slow, hour(4), upper, 2);
    expect(found.timestamp).toBeLessThan(hour(5));
    expect(await slow(found.block + 1)).toBeGreaterThanOrEqual(hour(5));
  });
});

describe("liquidityAt", () => {
  it("takes every later ModifyLiquidity delta back out of the maps at the cursor", () => {
    const event = (block: number, delta: bigint): PoolEvent => ({
      kind: "liquidity",
      poolId: "p",
      block,
      logIndex: 0,
      timestamp: 0,
      tickLower: -600,
      tickUpper: 600,
      liquidityDelta: delta,
      sender: "0x",
      salt: ZERO,
    });
    const { maps } = liquidityAt({ p: new Map([[RANGE, 25n]]) }, [event(10, 10n), event(20, 20n), event(30, -5n)], [35, 25, 15, 5]);
    expect(maps.get(35)!.p.get(RANGE)).toBe(25n);
    expect(maps.get(25)!.p.get(RANGE)).toBe(30n);
    expect(maps.get(15)!.p.get(RANGE)).toBe(10n);
    expect(maps.get(5)!.p.has(RANGE)).toBe(false);
  });
});

describe("runHourBackfill", () => {
  it("dry run: answers the counts from Redis alone, with no RPC call and no write", async () => {
    await kv.hset(hourKey("polygon", EUSD_EMXN.id), { [hour(9)]: JSON.stringify(STORED) });
    const before = JSON.stringify([...kv.hashes].map(([key, hash]) => [key, [...hash]]));
    const client = jest.fn();

    const body = await runHourBackfill("polygon", deps(client), { dryRun: true, limit: 4 });

    expect(body).toMatchObject({
      dryRun: true,
      to: new Date(hour(9) * 1000).toISOString(),
      hoursMissing: 10,
      rowsMissing: 10 * pools.length - 1,
      hoursToFill: 4,
      hoursFilled: 0,
      rowsWritten: 0,
      next: hour(6),
      done: false,
    });
    expect(client).not.toHaveBeenCalled();
    expect(JSON.stringify([...kv.hashes].map(([key, hash]) => [key, [...hash]]))).toBe(before);
  });

  it("fills the newest missing hours first, never replaces a stored row, and continues below `next` until done", async () => {
    await kv.hset(hourKey("polygon", EUSD_EMXN.id), { [hour(9)]: JSON.stringify(STORED) });
    const chain = fakeChain(LOGS);

    const first = await runHourBackfill("polygon", deps(() => chain.client), { limit: 3 });
    expect(first).toMatchObject({ hoursToFill: 3, hoursFilled: 3, rowsWritten: 3 * pools.length - 1, rowsKept: 0, next: hour(7), done: false });
    expect(await rowOf(EUSD_EMXN.id, 9)).toEqual(STORED);
    expect(await rowOf(WETH_TEL.id, 6)).toBeUndefined();

    const second = await runHourBackfill("polygon", deps(() => chain.client), { before: first.next! });
    expect(second).toMatchObject({ hoursMissing: 7, hoursFilled: 7, rowsWritten: 7 * pools.length, next: null, done: true });

    const third = await runHourBackfill("polygon", deps(() => chain.client), { dryRun: true });
    expect(third).toMatchObject({ hoursMissing: 0, rowsMissing: 0, done: true });
    // Nothing is written for the cursor's hour, which the cron owns.
    expect(await rowOf(WETH_TEL.id, 10)).toBeUndefined();
  });

  it("writes each row as the cron closes an hour: the hour's swaps, closing price, token prices and lens TVL", async () => {
    const chain = fakeChain(LOGS);
    await runHourBackfill("polygon", deps(() => chain.client), { limit: 3 });

    const weth9 = (await rowOf(WETH_TEL.id, 9))!;
    expect(weth9).toMatchObject({ swaps: 1, sqrtPriceX96: SQRT_PRICES[WETH_TEL.id].toString(), tick: 0, price0USD: 2000 });
    expect(weth9.volumeUSD).toBeCloseTo(2000, 6); // 1 WETH at the ETH/USD feed
    expect(weth9.feesUSD).toBeCloseTo(2000 * 0.003499, 6);
    expect(weth9.price1USD).toBeCloseTo(0.002, 9); // 1,000,000 TEL per WETH
    expect(weth9.tvlUSD).toBeCloseTo(10 * 2000 + 1_000_000 * 0.002, 3); // lens: 10 WETH and 1,000,000 TEL

    expect(await rowOf(EUSD_TEL.id, 8)).toMatchObject({ swaps: 1, volumeUSD: 100 });
    expect(await rowOf(EUSD_TEL.id, 9)).toMatchObject({ swaps: 0, volumeUSD: 0, feesUSD: 0 });
    // One bundle per hour, and one getLogs between each two boundaries from the end of hour 6 to the cursor.
    expect(chain.calls.eth_call).toBe(3);
    expect(chain.calls.eth_getLogs).toBe(4);
  });

  it("without the lens, values TVL with the position sum as it stood at the hour's closing block", async () => {
    const chain = fakeChain(LOGS, { noLens: WETH_TEL.id });
    await runHourBackfill("polygon", deps(() => chain.client), { limit: 10 });

    // The range was added in hour 5, so the hours before it held nothing.
    expect((await rowOf(WETH_TEL.id, 4))!.tvlUSD).toBe(0);
    expect((await rowOf(WETH_TEL.id, 5))!.tvlUSD).toBeGreaterThan(0);
    expect((await rowOf(WETH_TEL.id, 9))!.tvlUSD).toBe((await rowOf(WETH_TEL.id, 5))!.tvlUSD);
  });

  it("keeps a row that appears between the read and the write, and counts it as kept", async () => {
    const chain = fakeChain(LOGS);
    // The read sees no rows; by the time of the write one exists.
    const redis = { ...kv, hmget: async () => null } as unknown as HourBackfillRedis;
    await kv.hset(hourKey("polygon", EUSD_EMXN.id), { [hour(9)]: JSON.stringify(STORED) });

    const body = await runHourBackfill("polygon", deps(() => chain.client, { redis }), { limit: 1 });

    expect(body).toMatchObject({ hoursFilled: 1, rowsWritten: pools.length - 1, rowsKept: 1 });
    expect(await rowOf(EUSD_EMXN.id, 9)).toEqual(STORED);
  });

  it("fails without a cursor, since the chain's RPC backfill has not run", async () => {
    await kv.del(cursorKey("polygon"));
    await expect(runHourBackfill("polygon", deps(jest.fn()), { dryRun: true })).rejects.toThrow("no cursor");
  });
});

describe("runHourBackfillJob", () => {
  const jobDeps = (client: () => unknown) => ({
    client: client as HourBackfillDeps["client"],
    redis: kv as unknown as HourBackfillRedis,
    now: () => NOW_MS,
    config,
    pools,
  });
  const LOCKED = { status: 409, body: { error: "A run for this chain is in progress" } };

  it("takes the chain's lock for a write run and releases it", async () => {
    const chain = fakeChain(LOGS);
    const result = await runHourBackfillJob("polygon", { limit: 1 }, jobDeps(() => chain.client));
    expect(result).toMatchObject({ status: 200, body: { hoursFilled: 1 } });
    expect(await kv.get(lockKey("polygon"))).toBeNull();
  });

  it("answers 409 while another run holds the lock, but a dry run still answers", async () => {
    await kv.set(lockKey("polygon"), "cron", { nx: true, px: 60_000 });
    const client = jest.fn();
    expect(await runHourBackfillJob("polygon", { limit: 1 }, jobDeps(client))).toEqual(LOCKED);
    const dryRun = await runHourBackfillJob("polygon", { dryRun: true }, jobDeps(client));
    expect(dryRun).toMatchObject({ status: 200, body: { dryRun: true, hoursMissing: 10 } });
    expect(client).not.toHaveBeenCalled();
    expect(await kv.get(lockKey("polygon"))).toBe("cron");
  });

  it("answers a fixed 500 when the run fails", async () => {
    await kv.del(cursorKey("polygon"));
    const result = await runHourBackfillJob("polygon", { dryRun: true }, jobDeps(jest.fn()));
    expect(result).toEqual({ status: 500, body: { error: "Hourly backfill failed" } });
  });
});
