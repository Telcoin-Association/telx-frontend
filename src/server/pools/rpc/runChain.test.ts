/**
 * @jest-environment node
 */
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, pad, parseAbiParameters, toHex, type Hex } from "viem";

import type { RawLog } from "@/server/chain/logs";

import { rpcPoolsFor } from "../registry";
import { memoryRedis } from "../testing";
import { CHAINLINK_FEED_ABI, MODIFY_LIQUIDITY_TOPIC, MULTICALL3_ABI, RESERVES_LENS_ABI, STATE_VIEW_ABI, SWAP_TOPIC } from "./abi";
import { CHAINS, type ChainConfig } from "./chains";
import { polygonTelPrice, POLYGON_TEL_MAX_AGE_SECONDS, runBackfill, runChain, type RunDeps } from "./runChain";
import { backfillKey, cursorKey, dayKey, lockKey, positionsKey, readPositionChanges, v3Key } from "./store";

const kv = { current: memoryRedis() };
jest.mock("../redis", () => ({ getRedis: () => kv.current }));

// Imported after the mock so that runCronWrite writes to the in-memory store.
import { runRpcJob } from "./job";

/** Polygon's pools on a synthetic chain with 2-second blocks, 12-hour chunks of 21,600 blocks and 1-hour backfill chunks. */
const config: ChainConfig = { ...CHAINS.polygon, blockTime: 2, maxBlocksPerChunk: 21_600, backfillChunkBlocks: 1_800 };
const pools = rpcPoolsFor("polygon");
const [WETH_TEL, EUSD_TEL, EUSD_EMXN] = ["0xa22a3fb3", "0x1266df87", "0xe604df8f"].map(prefix => pools.find(pool => pool.id.startsWith(prefix))!);
const FIRST = Math.min(...pools.map(pool => pool.createdBlock));
const T0 = 1_790_121_600; // 00:00 UTC on the synthetic creation day
const timeOf = (block: number) => T0 + (block - FIRST) * 2;
const NOW_MS = 1_900_000_000_000;
const ZERO = pad("0x", { size: 32 });
const Q96 = 2n ** 96n;

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

function liquidityLog(block: number, logIndex: number, poolId: string, tickLower: number, tickUpper: number, delta: bigint): RawLog {
  return {
    ...swapLog(block, logIndex, poolId, 0n, 0n),
    data: encodeAbiParameters(parseAbiParameters("int24, int24, int256, bytes32"), [tickLower, tickUpper, delta, ZERO]),
    topics: [MODIFY_LIQUIDITY_TOPIC, poolId as Hex, ZERO],
  };
}

/** A ModifyLiquidity log sent by the PositionManager for token `tokenId`, which it passes as the salt. */
function positionLog(block: number, logIndex: number, poolId: string, tokenId: bigint, delta: bigint, sender: string = config.contracts.positionManager): RawLog {
  return {
    ...swapLog(block, logIndex, poolId, 0n, 0n),
    data: encodeAbiParameters(parseAbiParameters("int24, int24, int256, bytes32"), [-600, 600, delta, pad(toHex(tokenId), { size: 32 })]),
    topics: [MODIFY_LIQUIDITY_TOPIC, poolId as Hex, pad(sender as Hex, { size: 32 })],
  };
}

/** A fake RPC node over `logs`, whose finalized block is `finalized`. Counts calls per method. `unreadable` fails that pool's lens and slot0. */
function fakeChain(logs: RawLog[], finalized: number, options: { unreadable?: string } = {}) {
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
      pool.id === options.unreadable
        ? failed
        : ok(lens(pool.id === EUSD_EMXN.id ? 10n ** 9n : 10n ** 10n * (pool.id === WETH_TEL.id ? 10n ** 9n : 1n), 10n ** 24n)),
      pool.id === options.unreadable
        ? failed
        : ok(encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getSlot0", result: [SQRT_PRICES[pool.id], 0, 2_048_500, 3000] })),
      ok(encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: "getLiquidity", result: 1n })),
    ]),
  ];

  const tags: string[] = [];
  const request = jest.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    calls[method] = (calls[method] ?? 0) + 1;
    const args = params as unknown[];
    if (method === "eth_call") {
      const [call, tag] = args as [{ data: Hex }, string];
      expect(decodeFunctionData({ abi: MULTICALL3_ABI, data: call.data }).functionName).toBe("aggregate3");
      tags.push(tag);
      const block = tag === "finalized" || tag === "safe" ? finalized : Number.parseInt(tag, 16);
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: bundle(block) });
    }
    if (method === "eth_getLogs") {
      const [{ fromBlock, toBlock }] = args as [{ fromBlock: Hex; toBlock: Hex }];
      const from = Number.parseInt(fromBlock, 16);
      const to = Number.parseInt(toBlock, 16);
      return logs.filter(log => Number.parseInt(log.blockNumber, 16) >= from && Number.parseInt(log.blockNumber, 16) <= to);
    }
    if (method === "eth_getBlockByNumber") return { timestamp: toHex(timeOf(Number.parseInt((args as [Hex])[0], 16))) };
    throw new Error(`unexpected ${method}`);
  });
  return { client: { request }, calls, request, tags };
}

const LOGS = [
  liquidityLog(FIRST + 100, 0, WETH_TEL.id, -600, 600, 10n ** 20n),
  swapLog(FIRST + 2_000, 0, WETH_TEL.id, -(10n ** 18n), 996_501n * 10n ** 18n), // 1 WETH in
  swapLog(FIRST + 2_000, 1, EUSD_TEL.id, -(100n * 10n ** 6n), 49_825n * 10n ** 18n), // 100 eUSD in
  liquidityLog(FIRST + 3_000, 0, WETH_TEL.id, -600, 600, -(10n ** 20n)),
  swapLog(FIRST + 50_000, 0, WETH_TEL.id, 5n * 10n ** 17n, -(5n * 10n ** 23n)), // 500,000 TEL in for 0.5 WETH
];

function deps(client: RunDeps["client"], extra: Partial<RunDeps> = {}): RunDeps {
  return { client, redis: kv.current as never, now: () => NOW_MS, config, pools, ...extra };
}

async function setCursor(block: number, ids: string[] = pools.map(pool => pool.id).sort()) {
  await kv.current.hset(cursorKey("polygon"), { block, timestamp: timeOf(block), updatedAt: 0, pools: JSON.stringify(ids) });
}

const dump = () => Object.fromEntries([...kv.current.hashes].map(([key, hash]) => [key, Object.fromEntries(hash)]));

beforeEach(() => {
  kv.current = memoryRedis();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("runBackfill", () => {
  it("walks from the first pool's creation in one-hour chunks, then writes the cursor at the finalized block", async () => {
    const finalized = FIRST + 5_000;
    const chain = fakeChain(LOGS, finalized);

    const result = await runBackfill("polygon", deps(chain.client));

    expect(result).toMatchObject({ done: true, nextBlock: finalized + 1, finalizedBlock: finalized, chunks: 3 });
    expect(dump()[cursorKey("polygon")]).toEqual({
      block: String(finalized),
      timestamp: String(timeOf(finalized)),
      updatedAt: String(NOW_MS),
      pools: JSON.stringify(pools.map(pool => pool.id).sort()),
    });
    expect(kv.current.hashes.has(backfillKey("polygon"))).toBe(false);
    // One snapshot per chunk plus the finalized one, one getLogs per chunk, one block time per pool and one for the start.
    expect(chain.calls).toEqual({ eth_call: 3, eth_getLogs: 3, eth_getBlockByNumber: pools.length + 1 });
    // The range added and removed at blocks 100 and 3,000 nets to nothing.
    expect(kv.current.hashes.has(`rpc:polygon:liq:${WETH_TEL.id}`)).toBe(false);
  });

  it("resumes where the last call stopped, and a chain with a cursor is done", async () => {
    const finalized = FIRST + 5_000;
    const chain = fakeChain(LOGS, finalized);
    let clock = NOW_MS;
    const slowNow = () => (clock += 40_000); // 40 seconds pass between clock reads

    const first = await runBackfill("polygon", deps(chain.client, { now: slowNow }));
    expect(first).toMatchObject({ done: false, chunks: 1, nextBlock: FIRST + 1_800 });
    expect(dump()[backfillKey("polygon")]).toMatchObject({ nextBlock: String(FIRST + 1_800) });

    const second = await runBackfill("polygon", deps(chain.client));
    expect(second).toMatchObject({ done: true, chunks: 2 });
    expect(await runBackfill("polygon", deps(chain.client))).toMatchObject({ done: true, chunks: 0 });
  });

  it("starts again from creation with reset, and drops the old payload", async () => {
    const chain = fakeChain(LOGS, FIRST + 5_000);
    await runBackfill("polygon", deps(chain.client));
    const before = dump();
    await kv.current.hset(v3Key("polygon"), { fetchedAt: 1, data: "[]" });

    const again = await runBackfill("polygon", deps(chain.client), { reset: true });

    expect(again).toMatchObject({ done: true, chunks: 3 });
    expect(dump()).toEqual(before);
  });
});

describe("runChain", () => {
  it("fails when the active pools differ from the ones the backfill covered", async () => {
    await setCursor(
      FIRST + 1_000,
      pools
        .slice(1)
        .map(pool => pool.id)
        .sort(),
    );
    const chain = fakeChain(LOGS, FIRST + 2_000);

    await expect(runChain("polygon", deps(chain.client))).rejects.toThrow(
      `backfill needed; the active pools changed since it ran (added ${pools[0].id}`,
    );
    expect(chain.request).not.toHaveBeenCalled();
  });

  it("fails without a cursor, since the backfill has not run", async () => {
    await expect(runChain("polygon", deps(fakeChain(LOGS, FIRST + 10).client))).rejects.toThrow("no cursor; run the backfill first");
  });

  it("reads a 30-hour gap in 12-hour chunks and prices the swaps it finds", async () => {
    const cursor = FIRST + 1_000;
    const finalized = cursor + 54_000; // 30 hours of 2-second blocks
    await setCursor(cursor);
    const chain = fakeChain(LOGS, finalized);

    const run = await runChain("polygon", deps(chain.client, { now: () => timeOf(finalized) * 1000 }));

    expect(run.report).toMatchObject({ fromBlock: cursor + 1, toBlock: finalized, chunks: 3, logs: 4, calls: 3, computeUnits: 26 * 3 + 60 * 3 });
    expect(chain.calls.eth_call).toBe(3); // the finalized bundle plus one archive bundle for each of the first two chunks
    expect(dump()[cursorKey("polygon")]).toMatchObject({ block: String(finalized) });

    const wethTel = run.pools.find(pool => pool.id === WETH_TEL.id)!;
    // The swap at block 50,000 is under 3 hours before the end; the one at block 2,000 is over 29 hours before it.
    expect(wethTel.metrics).toMatchObject({ rows24h: 1, window: "trailing-24h", lastSwapAt: timeOf(FIRST + 50_000) });
    expect(wethTel.metrics.volume24h).toBeCloseTo(1000, 6); // 0.5 WETH out at $2,000
    expect(wethTel.metrics.fees24h).toBeCloseTo(1000 * 0.003499, 3);
    expect(wethTel.poolSnapshots).toHaveLength(48);
    expect(wethTel.pool.feesUSD).toBeCloseTo(2000 * 0.003499 + 1000 * 0.003499, 3);
  });

  it("records PositionManager liquidity changes per token and the day's closing price", async () => {
    const cursor = FIRST + 1_000;
    const head = cursor + 3_000;
    await setCursor(cursor);
    const logs = [
      positionLog(cursor + 10, 0, WETH_TEL.id, 42n, 5n * 10n ** 18n),
      positionLog(cursor + 20, 1, WETH_TEL.id, 7n, 10n ** 18n, "0x00000000000000000000000000000000000000aa"),
      positionLog(cursor + 30, 2, WETH_TEL.id, 42n, -(2n * 10n ** 18n)),
    ];
    await runChain("polygon", deps(fakeChain(logs, head).client, { now: () => timeOf(head) * 1000 }));

    const changes = await readPositionChanges(kv.current as never, "polygon", WETH_TEL.id, 42n);
    expect(changes.map(({ t, d, tickLower, tickUpper, block }) => ({ t, d, tickLower, tickUpper, block }))).toEqual([
      { t: timeOf(cursor + 10), d: String(5n * 10n ** 18n), tickLower: -600, tickUpper: 600, block: cursor + 10 },
      { t: timeOf(cursor + 30), d: String(-(2n * 10n ** 18n)), tickLower: -600, tickUpper: 600, block: cursor + 30 },
    ]);
    // Another contract's position with the same salt is not a PositionManager token.
    expect(await readPositionChanges(kv.current as never, "polygon", WETH_TEL.id, 7n)).toEqual([]);
    expect(Object.keys(dump()[positionsKey("polygon", WETH_TEL.id)])).toHaveLength(2);

    const day = JSON.parse(dump()[dayKey("polygon", WETH_TEL.id)][String(Math.floor(timeOf(head) / 86_400) * 86_400)]);
    expect(day).toMatchObject({ sqrtPriceX96: expect.any(String), tick: expect.any(Number) });
    expect(day.price0USD).toBeGreaterThan(0);
    expect(day.price1USD).toBeGreaterThan(0);
  });

  it("reads up to the chain's head tag: safe where configured, finalized on Polygon", async () => {
    expect(CHAINS.base.headTag).toBe("safe");
    expect(CHAINS.ethereum.headTag).toBe("safe");
    expect(CHAINS.polygon.headTag).toBe("finalized");

    const cursor = FIRST + 1_000;
    const head = cursor + 100;
    await setCursor(cursor);
    const chain = fakeChain(LOGS, head);
    const run = await runChain("polygon", deps(chain.client, { config: { ...config, headTag: "safe" }, now: () => timeOf(head) * 1000 }));

    expect(chain.tags[0]).toBe("safe");
    expect(chain.tags).not.toContain("finalized");
    expect(run.report).toMatchObject({ toBlock: head });
    expect(dump()[cursorKey("polygon")]).toMatchObject({ block: String(head) });
  });

  it("withholds the 24h values while it is still catching up", async () => {
    const cursor = FIRST + 1_000;
    const finalized = cursor + 5 * 21_600 + 10; // more than four chunks behind
    await setCursor(cursor);

    const run = await runChain("polygon", deps(fakeChain(LOGS, finalized).client, { now: () => timeOf(finalized) * 1000 }));

    expect(run.report.chunks).toBe(4);
    expect(run.pools[0].metrics).toMatchObject({ volume24h: null, fees24h: null, window: null });
    expect(run.warnings).toEqual(expect.arrayContaining([expect.stringContaining("24h values withheld")]));
  });

  it("builds the payload from the stored data when the finalized block has not moved", async () => {
    await setCursor(FIRST + 5_000);
    const chain = fakeChain(LOGS, FIRST + 5_000);

    const run = await runChain("polygon", deps(chain.client, { now: () => timeOf(FIRST + 5_000) * 1000 }));

    expect(run.report.chunks).toBe(0);
    expect(chain.calls).toEqual({ eth_call: 1 });
    expect(run.pools).toHaveLength(3);
  });

  it("ends with the same state when a failed write makes a run repeat its range", async () => {
    const cursor = FIRST + 1_000;
    const finalized = cursor + 54_000;
    const now = () => timeOf(finalized) * 1000;

    await setCursor(cursor);
    await runChain("polygon", deps(fakeChain(LOGS, finalized).client, { now }));
    const once = dump();

    kv.current = memoryRedis();
    await setCursor(cursor);
    kv.current.failExec();
    await expect(runChain("polygon", deps(fakeChain(LOGS, finalized).client, { now }))).rejects.toThrow("EXEC failed");
    expect(dump()[cursorKey("polygon")]).toMatchObject({ block: String(cursor) });
    await runChain("polygon", deps(fakeChain(LOGS, finalized).client, { now }));

    expect(dump()).toEqual(once);
  });
});

describe("runRpcJob", () => {
  it("writes the v3 payload through runCronWrite and records the run", async () => {
    await setCursor(FIRST + 1_000);
    const finalized = FIRST + 3_000;
    const result = await runRpcJob("polygon", {
      ...deps(fakeChain(LOGS, finalized).client, { now: () => timeOf(finalized) * 1000 }),
      merklTel: async () => ({ usd: null, warning: "Merkl TEL price: HTTP 500" }),
    });

    expect(result).toMatchObject({ status: 200, body: { ok: true, updated: true, key: v3Key("polygon"), pools: 3 } });
    const payload = dump()[v3Key("polygon")];
    expect(payload).toMatchObject({ indexedAt: String(timeOf(finalized) * 1000), hasIndexingErrors: "false" });
    expect(JSON.parse(payload.data)).toHaveLength(3);
    const status = dump()[`status:${v3Key("polygon")}`];
    expect(JSON.parse(status.lastRun)).toMatchObject({ fromBlock: FIRST + 1_001, toBlock: finalized, chunks: 1 });
    // The cursor starts after the range added at block 100, so its removal at block 3,000 is flagged.
    expect(JSON.parse(status.warnings)).toEqual(["Merkl TEL price: HTTP 500", expect.stringContaining("range -600:600 of pool 0xa22a3fb3")]);
    expect(await kv.current.get(lockKey("polygon"))).toBeNull();
  });

  it("publishes a pool it cannot value with a null TVL rather than failing the chain", async () => {
    await setCursor(FIRST + 1_000);
    const finalized = FIRST + 3_000;
    const result = await runRpcJob("polygon", {
      ...deps(fakeChain(LOGS, finalized, { unreadable: WETH_TEL.id }).client, { now: () => timeOf(finalized) * 1000 }),
      merklTel: async () => ({ usd: null }),
    });

    expect(result).toMatchObject({ status: 200, body: { updated: true } });
    const data = JSON.parse(dump()[v3Key("polygon")].data);
    const wethTel = data.find((pool: { id: string }) => pool.id === WETH_TEL.id);
    expect(wethTel.pool.totalValueLockedUSD).toBeNull();
    expect(wethTel.metrics.tvlUSD).toBeNull();
    expect(data.find((pool: { id: string }) => pool.id === EUSD_TEL.id).pool.totalValueLockedUSD).toBeGreaterThan(0);
  });

  it("skips while another run holds the lock", async () => {
    await kv.current.set(lockKey("polygon"), "other-run", { nx: true, px: 60_000 });
    const chain = fakeChain(LOGS, FIRST + 10);

    const result = await runRpcJob("polygon", deps(chain.client));

    expect(result).toEqual({ status: 200, body: { ok: true, updated: false, skipped: "a previous run still holds the lock" } });
    expect(chain.request).not.toHaveBeenCalled();
  });

  it("leaves the data keys alone on an RPC error and records it, without the error's details in the answer", async () => {
    await setCursor(FIRST + 1_000);
    await kv.current.hset(v3Key("polygon"), { fetchedAt: 1, indexedAt: 1, hasIndexingErrors: false, data: "[]" });
    const before = dump();
    const failing = {
      request: jest.fn(async () => Promise.reject(new Error("polygon eth_call: HttpRequestError: HTTP request failed. (HTTP 429)"))),
    };

    const result = await runRpcJob("polygon", deps(failing));

    expect(result).toEqual({ status: 500, body: { error: "Cron job failed" } });
    const after = dump();
    expect(after[v3Key("polygon")]).toEqual(before[v3Key("polygon")]);
    expect(after[cursorKey("polygon")]).toEqual(before[cursorKey("polygon")]);
    expect(after[`status:${v3Key("polygon")}`].lastError).toContain("HTTP 429");
    expect(await kv.current.get(lockKey("polygon"))).toBeNull();
  });
});

describe("polygonTelPrice", () => {
  it("gives Polygon's stored TEL price while Polygon's state is at most an hour old", async () => {
    const tokens = { "0x7e13b43065380acdec1c2d138c579cbbbafa0731": { usd: 0.0024, source: "pools" } };
    await kv.current.hset("rpc:polygon:state", { timestamp: 10_000, prices: JSON.stringify({ tokens, telRoutes: [], impliedEusd: null }) });

    await expect(polygonTelPrice(kv.current as never, 10_000 + POLYGON_TEL_MAX_AGE_SECONDS)).resolves.toEqual({ usd: 0.0024 });
    await expect(polygonTelPrice(kv.current as never, 10_001 + POLYGON_TEL_MAX_AGE_SECONDS)).resolves.toEqual({
      usd: null,
      warning: "Polygon's TEL price is 3601s old; not used",
    });
  });

  it("is null when Polygon has no state", async () => {
    await expect(polygonTelPrice(kv.current as never, 1)).resolves.toEqual({ usd: null });
  });
});
