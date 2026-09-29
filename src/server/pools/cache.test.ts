/**
 * @jest-environment node
 */

import {
  parseSnapshot,
  readPartMeta,
  readSnapshot,
  readStatus,
  recordFailure,
  recordSuccess,
  snapshotResponse,
  statusKey,
  writeSnapshot,
  type Snapshot,
} from "./cache";
import { fakeRedis } from "./testing";

const kvMock = fakeRedis();
jest.mock("./redis", () => ({ getRedis: () => kvMock }));

const snapshot: Snapshot = {
  fetchedAt: 2_000,
  indexedAt: 1_900,
  hasIndexingErrors: false,
  data: [{ id: "0xa", pool: { id: "0xa" }, poolSnapshots: [{ periodStartUnix: 10 }], threeMonthLiquidityData: [{ timestamp: 1 }] }],
};

describe("key names", () => {
  it("prefixes status hashes", () => {
    expect(statusKey("active-uniswap-base-grouped:v3")).toBe("status:active-uniswap-base-grouped:v3");
  });
});

describe("snapshotResponse", () => {
  it("serves the rows as they are, with the key's freshness as both parts", () => {
    const meta = { fetchedAt: 2_000, indexedAt: 1_900, hasIndexingErrors: false };
    expect(snapshotResponse(snapshot)).toEqual({ ...meta, parts: { hourly: meta, daily: meta, legacy: false }, data: snapshot.data });
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

  it("records a failure on the status hash only", async () => {
    await recordFailure("k", "boom", 7);
    expect(kvMock.hset).toHaveBeenCalledWith("status:k", { lastError: "boom", lastErrorAt: 7 });
  });

  it("records a success and clears the last error in one transaction", async () => {
    const { transaction } = kvMock;
    await recordSuccess("k", [], 8);
    expect(transaction.hset).toHaveBeenCalledWith("status:k", { lastSuccessAt: 8 });
    expect(transaction.hdel).toHaveBeenCalledWith("status:k", "lastError", "lastErrorAt", "warnings");
    expect(transaction.exec).toHaveBeenCalledTimes(1);
    expect(kvMock.hset).not.toHaveBeenCalled();
    expect(kvMock.hdel).not.toHaveBeenCalled();
  });

  it("keeps the warnings of a successful run on the status hash", async () => {
    const { transaction } = kvMock;
    await recordSuccess("k", ["pool 0xb skipped"], 9);
    expect(transaction.hset).toHaveBeenCalledWith("status:k", { lastSuccessAt: 9, warnings: '["pool 0xb skipped"]' });
    expect(transaction.hdel).toHaveBeenCalledWith("status:k", "lastError", "lastErrorAt");
    expect(transaction.exec).toHaveBeenCalledTimes(1);
  });

  it("reads the status hash, tolerating a missing key", async () => {
    kvMock.hgetall.mockResolvedValueOnce({ lastError: 404, lastErrorAt: 7, lastSuccessAt: "6", warnings: ["w"] });
    await expect(readStatus("k")).resolves.toEqual({ lastError: "404", lastErrorAt: 7, lastSuccessAt: 6, warnings: ["w"] });
    kvMock.hgetall.mockResolvedValueOnce({ lastSuccessAt: 6, warnings: '["w1","w2"]' });
    await expect(readStatus("k")).resolves.toMatchObject({ warnings: ["w1", "w2"] });
    kvMock.hgetall.mockResolvedValueOnce(null);
    await expect(readStatus("k")).resolves.toEqual({ lastError: null, lastErrorAt: null, lastSuccessAt: null, warnings: [] });
    kvMock.hgetall.mockResolvedValueOnce({ lastSuccessAt: 6, lastRun: { fromBlock: 1, toBlock: 9, chunks: 1 } });
    await expect(readStatus("k")).resolves.toMatchObject({ lastRun: { fromBlock: 1, toBlock: 9, chunks: 1 } });
  });
});
