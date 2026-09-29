/**
 * @jest-environment node
 */

import {
  dailyKey,
  hourlyKey,
  mergeGroupedParts,
  parseSnapshot,
  quickswapKey,
  readPartMeta,
  readSnapshot,
  readStatus,
  recordFailure,
  recordSuccess,
  singlePartResponse,
  statusKey,
  writeSnapshot,
  type Snapshot,
} from "./cache";
import type { PoolMetrics } from "./metrics";
import { fakeRedis } from "./testing";

const kvMock = fakeRedis();
jest.mock("./redis", () => ({ getRedis: () => kvMock }));

const metrics = (tvlUSD: number): PoolMetrics => ({
  tvlUSD,
  volume24h: 0,
  fees24h: 0,
  window: "trailing-24h",
  lastActivityAt: null,
  lastSwapAt: null,
  createdAt: null,
  rows24h: 0,
  computedAt: 1,
});

const hourly: Snapshot = {
  fetchedAt: 2_000,
  indexedAt: 1_900,
  hasIndexingErrors: false,
  data: [
    {
      id: "0xa",
      pool: { id: "0xa", totalLiquidity: "2" },
      poolSnapshots: [{ timestamp: 10 }],
      swaps: [{ id: "s1", timestamp: 11, valueUSD: "5", poolId: { id: "0xa" } }],
      metrics: metrics(2),
    },
    { id: "0xb", pool: { id: "0xb" }, poolSnapshots: [], metrics: metrics(0) },
  ],
};

const daily: Snapshot = {
  fetchedAt: 1_000,
  indexedAt: 900,
  hasIndexingErrors: true,
  data: [
    { id: "0xa", pool: { id: "0xa", totalLiquidity: "1" }, threeMonthLiquidityData: [{ timestamp: 1 }] },
    { id: "0xc", pool: { id: "0xc" }, threeMonthLiquidityData: [{ timestamp: 2 }] },
  ],
};

describe("key names", () => {
  it("match the documented KV layout", () => {
    expect(hourlyKey("uniswap-base")).toBe("active-uniswap-base-grouped:hourly:v2");
    expect(dailyKey("balancer")).toBe("active-balancer-grouped:daily:v2");
    expect(quickswapKey).toBe("active-quickswap-grouped:v2");
    expect(statusKey(hourlyKey("uniswap-polygon"))).toBe("status:active-uniswap-polygon-grouped:hourly:v2");
  });
});

describe("mergeGroupedParts", () => {
  it("joins hourly and daily parts per pool id", () => {
    const merged = mergeGroupedParts(hourly, daily);

    expect(merged?.data).toEqual([
      {
        id: "0xa",
        pool: { id: "0xa", totalLiquidity: "2" },
        poolSnapshots: [{ timestamp: 10 }],
        threeMonthLiquidityData: [{ timestamp: 1 }],
        swaps: [{ id: "s1", timestamp: 11, valueUSD: "5", poolId: { id: "0xa" } }],
        metrics: metrics(2),
      },
      { id: "0xb", pool: { id: "0xb" }, poolSnapshots: [], threeMonthLiquidityData: [], metrics: metrics(0) },
      { id: "0xc", pool: { id: "0xc" }, poolSnapshots: [], threeMonthLiquidityData: [{ timestamp: 2 }] },
    ]);
  });

  it("takes freshness from the hourly part and ORs indexing errors", () => {
    const merged = mergeGroupedParts(hourly, daily);

    expect(merged).toMatchObject({
      fetchedAt: 2_000,
      indexedAt: 1_900,
      hasIndexingErrors: true,
      parts: {
        hourly: { fetchedAt: 2_000, indexedAt: 1_900, hasIndexingErrors: false },
        daily: { fetchedAt: 1_000, indexedAt: 900, hasIndexingErrors: true },
        legacy: false,
      },
    });
    expect(merged?.parts.hourly).not.toHaveProperty("data");
  });

  it("serves the daily part alone with its freshness and metrics explicitly null", () => {
    const merged = mergeGroupedParts(null, daily);

    expect(merged).toMatchObject({ fetchedAt: 1_000, indexedAt: 900, hasIndexingErrors: true });
    expect(merged?.parts).toEqual({ hourly: null, daily: { fetchedAt: 1_000, indexedAt: 900, hasIndexingErrors: true }, legacy: false });
    expect(merged?.data[0]).toEqual({
      id: "0xa",
      pool: { id: "0xa", totalLiquidity: "1" },
      poolSnapshots: [],
      threeMonthLiquidityData: [{ timestamp: 1 }],
      metrics: null,
    });
    expect(merged?.data.every(pool => pool.metrics === null)).toBe(true);
  });

  it("serves the hourly part alone with empty history", () => {
    const merged = mergeGroupedParts(hourly, null);

    expect(merged).toMatchObject({ fetchedAt: 2_000, hasIndexingErrors: false, parts: { daily: null, legacy: false } });
    expect(merged?.data.map(pool => pool.threeMonthLiquidityData)).toEqual([[], []]);
  });

  it("returns null when neither part exists", () => {
    expect(mergeGroupedParts(null, null)).toBeNull();
  });
});

describe("singlePartResponse", () => {
  it("reports QuickSwap's single key as the daily part", () => {
    expect(singlePartResponse(daily)).toEqual({
      fetchedAt: 1_000,
      indexedAt: 900,
      hasIndexingErrors: true,
      parts: { hourly: null, daily: { fetchedAt: 1_000, indexedAt: 900, hasIndexingErrors: true }, legacy: false },
      data: daily.data,
    });
  });
});

describe("KV access", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("writes the data hash with the array as a JSON string", async () => {
    await writeSnapshot("k", { fetchedAt: 5, indexedAt: null, hasIndexingErrors: false, data: [{ id: "0xa" }] });
    expect(kvMock.hset).toHaveBeenCalledWith("k", {
      fetchedAt: 5,
      indexedAt: null,
      hasIndexingErrors: false,
      data: '[{"id":"0xa"}]',
    });
  });

  it("reads a hash kv already parsed", async () => {
    kvMock.hgetall.mockResolvedValueOnce({ fetchedAt: 5, indexedAt: 4, hasIndexingErrors: false, data: [{ id: "0xa" }] });
    await expect(readSnapshot("k")).resolves.toEqual({ fetchedAt: 5, indexedAt: 4, hasIndexingErrors: false, data: [{ id: "0xa" }] });
  });

  it("reads a hash with a string data field and no freshness fields", async () => {
    kvMock.hgetall.mockResolvedValueOnce({ fetchedAt: "5", data: '[{"id":"0xa"}]' });
    await expect(readSnapshot("k")).resolves.toEqual({ fetchedAt: 5, indexedAt: null, hasIndexingErrors: false, data: [{ id: "0xa" }] });
  });

  it("returns null for a missing key or unusable data", async () => {
    kvMock.hgetall.mockResolvedValueOnce(null);
    await expect(readSnapshot("k")).resolves.toBeNull();
    kvMock.hgetall.mockResolvedValueOnce({ fetchedAt: 5, data: "not json" });
    await expect(readSnapshot("k")).resolves.toBeNull();
    kvMock.hgetall.mockResolvedValueOnce({ fetchedAt: 5, data: { id: "0xa" } });
    await expect(readSnapshot("k")).resolves.toBeNull();
  });

  it("parses the raw string fields Redis stores", () => {
    expect(parseSnapshot({ fetchedAt: "5", indexedAt: "null", hasIndexingErrors: "true", data: '[{"id":"0xa"}]' })).toEqual({
      fetchedAt: 5,
      indexedAt: null,
      hasIndexingErrors: true,
      data: [{ id: "0xa" }],
    });
    expect(parseSnapshot({ fetchedAt: "not a number", data: "[]" })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });

  it("reads only the freshness fields for part metadata", async () => {
    kvMock.hmget.mockResolvedValueOnce({ fetchedAt: 5, indexedAt: null, hasIndexingErrors: true });
    await expect(readPartMeta("k")).resolves.toEqual({ fetchedAt: 5, indexedAt: null, hasIndexingErrors: true });
    expect(kvMock.hmget).toHaveBeenCalledWith("k", "fetchedAt", "indexedAt", "hasIndexingErrors");

    kvMock.hmget.mockResolvedValueOnce(null);
    await expect(readPartMeta("missing")).resolves.toBeNull();
  });

  it("records failures and successes on the status hash only", async () => {
    await recordFailure("k", "boom", 7);
    expect(kvMock.hset).toHaveBeenCalledWith("status:k", { lastError: "boom", lastErrorAt: 7 });

    await recordSuccess("k", [], 8);
    expect(kvMock.hset).toHaveBeenLastCalledWith("status:k", { lastSuccessAt: 8 });
    expect(kvMock.hdel).toHaveBeenCalledWith("status:k", "lastError", "lastErrorAt", "warnings");
  });

  it("keeps the warnings of a successful run on the status hash", async () => {
    await recordSuccess("k", ["archived pool 0xb missing"], 9);
    expect(kvMock.hset).toHaveBeenCalledWith("status:k", { lastSuccessAt: 9, warnings: '["archived pool 0xb missing"]' });
    expect(kvMock.hdel).toHaveBeenCalledWith("status:k", "lastError", "lastErrorAt");
  });

  it("reads the status hash, tolerating a missing key", async () => {
    kvMock.hgetall.mockResolvedValueOnce({ lastError: 404, lastErrorAt: 7, lastSuccessAt: "6", warnings: ["w"] });
    await expect(readStatus("k")).resolves.toEqual({ lastError: "404", lastErrorAt: 7, lastSuccessAt: 6, warnings: ["w"] });
    kvMock.hgetall.mockResolvedValueOnce({ lastSuccessAt: 6, warnings: '["w1","w2"]' });
    await expect(readStatus("k")).resolves.toMatchObject({ warnings: ["w1", "w2"] });
    kvMock.hgetall.mockResolvedValueOnce(null);
    await expect(readStatus("k")).resolves.toEqual({ lastError: null, lastErrorAt: null, lastSuccessAt: null, warnings: [] });
  });
});
