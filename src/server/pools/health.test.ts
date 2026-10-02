/**
 * @jest-environment node
 */

import { HEALTH_KEYS, buildHealth } from "./health";
import { fakeRedis, withEnv } from "./testing";

const kvMock = fakeRedis();
jest.mock("./redis", () => ({ getRedis: () => kvMock }));

const NOW = 1_800_000_000_000;

/** Every data key fetched `ageSeconds` ago (override per key, null for missing), and one status hash. */
function kvWithAges(ageSeconds: number, overrides: Record<string, number | null> = {}) {
  kvMock.hmget.mockImplementation(async (key: string) => {
    const age = key in overrides ? overrides[key] : ageSeconds;
    if (age === null) return null;
    return { fetchedAt: NOW - age * 1000, indexedAt: NOW - (age + 30) * 1000, hasIndexingErrors: false };
  });
  kvMock.hgetall.mockImplementation(async (key: string) =>
    key === "status:active-uniswap-polygon-grouped:v3"
      ? { lastError: "Uniswap polygon RPC: boom", lastErrorAt: NOW - 1000, lastSuccessAt: NOW - 60_000, warnings: ["pool skipped"] }
      : null,
  );
}

describe("buildHealth", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("covers each chain's RPC pipeline key, on a 5-minute schedule", () => {
    expect(HEALTH_KEYS.map(({ key, schedule }) => [key, schedule])).toEqual([
      ["active-uniswap-base-grouped:v3", "5m"],
      ["active-uniswap-polygon-grouped:v3", "5m"],
      ["active-uniswap-ethereum-grouped:v3", "5m"],
    ]);
  });

  it("gates on the chains with an active pool in pool.json", () => {
    expect(Object.fromEntries(HEALTH_KEYS.map(({ key, gating }) => [key, gating]))).toEqual({
      "active-uniswap-base-grouped:v3": true,
      "active-uniswap-polygon-grouped:v3": true,
      "active-uniswap-ethereum-grouped:v3": true,
    });
  });

  it("is ok when every key is fresh, and reports ages and status", async () => {
    kvWithAges(900);
    const health = await buildHealth(NOW);

    expect(health.ok).toBe(true);
    expect(health.now).toBe(NOW);
    expect(Object.keys(health.keys)).toHaveLength(3);
    expect(health.keys["active-uniswap-polygon-grouped:v3"]).toEqual({
      schedule: "5m",
      fetchedAt: NOW - 900_000,
      ageSeconds: 900,
      indexedAt: NOW - 930_000,
      indexedAgeSeconds: 930,
      indexingLagSeconds: 30,
      hasIndexingErrors: false,
      stale: false,
      lagging: false,
      gating: true,
      lastError: "Uniswap polygon RPC: boom",
      lastErrorAt: NOW - 1000,
      lastSuccessAt: NOW - 60_000,
      warnings: ["pool skipped"],
    });
  });

  it("is not ok when a key is older than 900 seconds", async () => {
    kvWithAges(60, { "active-uniswap-base-grouped:v3": 901 });
    const health = await buildHealth(NOW);

    expect(health.ok).toBe(false);
    expect(health.keys["active-uniswap-base-grouped:v3"].stale).toBe(true);
    expect(health.keys["active-uniswap-polygon-grouped:v3"].stale).toBe(false);
  });

  it("applies each chain's lag limit", async () => {
    kvMock.hmget.mockImplementation(async (key: string) => ({
      fetchedAt: NOW - 60_000,
      indexedAt: key === "active-uniswap-polygon-grouped:v3" ? NOW - 60_000 - 601_000 : NOW - 90_000,
      hasIndexingErrors: false,
    }));
    kvMock.hgetall.mockResolvedValue(null);
    const health = await buildHealth(NOW);

    expect(health.keys["active-uniswap-polygon-grouped:v3"]).toMatchObject({ gating: true, lagging: true, indexingLagSeconds: 601 });
    expect(health.keys["active-uniswap-base-grouped:v3"].lagging).toBe(false);
    expect(health.ok).toBe(false);
  });

  it("treats a missing key as stale", async () => {
    kvWithAges(60, { "active-uniswap-ethereum-grouped:v3": null });
    const health = await buildHealth(NOW);

    expect(health.ok).toBe(false);
    expect(health.keys["active-uniswap-ethereum-grouped:v3"]).toMatchObject({
      fetchedAt: null,
      ageSeconds: null,
      indexedAt: null,
      hasIndexingErrors: null,
      stale: true,
    });
  });
});

describe("buildHealth: the history export", () => {
  let restoreEnv = () => {};
  const DAY_MS = 86_400_000;

  beforeEach(() => {
    jest.resetAllMocks();
    restoreEnv = withEnv({ BLOB_STORE_ID: undefined, BLOB_READ_WRITE_TOKEN: undefined });
  });

  afterEach(() => restoreEnv());

  /** Fresh data keys, and the export status hash holding `status`. */
  function kvWithExport(status: Record<string, number> | null) {
    kvWithAges(60);
    const keys = kvMock.hgetall.getMockImplementation()!;
    kvMock.hgetall.mockImplementation(async (key: string) => (key === "history-export:status" ? status : keys(key)));
  }

  it("is null and does not gate while no Blob store is connected", async () => {
    kvWithExport(null);
    const health = await buildHealth(NOW);
    expect(health.historyExport).toBeNull();
    expect(health.ok).toBe(true);
    expect(kvMock.hgetall).not.toHaveBeenCalledWith("history-export:status");
  });

  it("reports the last export once configured, and is ok up to 36 hours", async () => {
    restoreEnv();
    restoreEnv = withEnv({ BLOB_STORE_ID: "store_test", BLOB_READ_WRITE_TOKEN: undefined });
    const lastDay = Date.UTC(2027, 0, 13) / 1000;
    kvWithExport({ firstDay: lastDay - 86_400, lastDay, lastExportAt: NOW - 36 * 3600 * 1000 });

    const health = await buildHealth(NOW);

    expect(health.historyExport).toEqual({ lastDay: "2027-01-13", lastExportAt: NOW - 36 * 3600 * 1000, ageSeconds: 36 * 3600, stale: false });
    expect(health.ok).toBe(true);
  });

  it("flags an export older than 36 hours, or none at all, once configured", async () => {
    restoreEnv();
    restoreEnv = withEnv({ BLOB_STORE_ID: undefined, BLOB_READ_WRITE_TOKEN: "token" });
    kvWithExport({ lastDay: 0, lastExportAt: NOW - 1.5 * DAY_MS - 1000 });
    let health = await buildHealth(NOW);
    expect(health.historyExport).toMatchObject({ stale: true });
    expect(health.ok).toBe(false);

    kvWithExport(null);
    health = await buildHealth(NOW);
    expect(health.historyExport).toEqual({ lastDay: null, lastExportAt: null, ageSeconds: null, stale: true });
    expect(health.ok).toBe(false);
  });
});
