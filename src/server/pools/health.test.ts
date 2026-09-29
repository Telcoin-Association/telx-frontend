/**
 * @jest-environment node
 */

import { HEALTH_KEYS, buildHealth } from "./health";
import { fakeRedis } from "./testing";

const kvMock = fakeRedis();
jest.mock("./redis", () => ({ getRedis: () => kvMock }));

const NOW = 1_800_000_000_000;

/** Serves Base and Ethereum from their subgraph keys alone, for the tests of v2 key gating. */
const V2_SOURCES = { "uniswap-base": "v2", "uniswap-ethereum": "v2" };

/** Every data key fetched `ageSeconds` ago (override per key), no status hashes, and `sources` as the source switch. */
function kvWithAges(ageSeconds: number, overrides: Record<string, number | null> = {}, sources: Record<string, string> | null = null) {
  kvMock.hmget.mockImplementation(async (key: string) => {
    const age = key in overrides ? overrides[key] : ageSeconds;
    if (age === null) return null;
    return { fetchedAt: NOW - age * 1000, indexedAt: NOW - (age + 30) * 1000, hasIndexingErrors: false };
  });
  kvMock.hgetall.mockImplementation(async (key: string) => {
    if (key === "config:grouped-source") return sources;
    return key === "status:active-uniswap-polygon-grouped:hourly:v2"
      ? { lastError: "Uniswap polygon hourly: boom", lastErrorAt: NOW - 1000, lastSuccessAt: NOW - 60_000, warnings: ["archived pool missing"] }
      : null;
  });
}

describe("buildHealth", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("covers seven 5m keys and five 1h keys", () => {
    expect(HEALTH_KEYS.filter((k) => k.schedule === "5m").map((k) => k.key)).toEqual([
      "active-uniswap-base-grouped:hourly:v2",
      "active-uniswap-polygon-grouped:hourly:v2",
      "active-uniswap-ethereum-grouped:hourly:v2",
      "active-balancer-grouped:hourly:v2",
      "active-uniswap-polygon-grouped:v3",
      "active-uniswap-base-grouped:v3",
      "active-uniswap-ethereum-grouped:v3",
    ]);
    expect(HEALTH_KEYS.filter((k) => k.schedule === "1h").map((k) => k.key)).toEqual([
      "active-uniswap-base-grouped:daily:v2",
      "active-uniswap-polygon-grouped:daily:v2",
      "active-uniswap-ethereum-grouped:daily:v2",
      "active-balancer-grouped:daily:v2",
      "active-quickswap-grouped:v2",
    ]);
  });

  it("is ok when every key is fresh, and reports ages and status", async () => {
    kvWithAges(900);
    const health = await buildHealth(NOW);

    expect(health.ok).toBe(true);
    expect(health.now).toBe(NOW);
    expect(Object.keys(health.keys)).toHaveLength(12);
    expect(health.keys["active-uniswap-polygon-grouped:hourly:v2"]).toEqual({
      schedule: "5m",
      fetchedAt: NOW - 900_000,
      ageSeconds: 900,
      indexedAt: NOW - 930_000,
      indexedAgeSeconds: 930,
      indexingLagSeconds: 30,
      hasIndexingErrors: false,
      stale: false,
      lagging: false,
      // Polygon is served from the RPC pipeline by default, so its subgraph keys do not gate.
      gating: false,
      lastError: "Uniswap polygon hourly: boom",
      lastErrorAt: NOW - 1000,
      lastSuccessAt: NOW - 60_000,
      warnings: ["archived pool missing"],
    });
  });

  it("is not ok when a 5m key is older than 900 seconds", async () => {
    kvWithAges(60, { "active-uniswap-base-grouped:hourly:v2": 901 }, V2_SOURCES);
    const health = await buildHealth(NOW);

    expect(health.ok).toBe(false);
    expect(health.keys["active-uniswap-base-grouped:hourly:v2"].stale).toBe(true);
    expect(health.keys["active-uniswap-base-grouped:daily:v2"].stale).toBe(false);
  });

  it("gives 1h keys 10800 seconds", async () => {
    kvWithAges(10_800);
    let health = await buildHealth(NOW);
    expect(health.keys["active-uniswap-base-grouped:daily:v2"].stale).toBe(false);

    kvWithAges(60, { "active-uniswap-base-grouped:daily:v2": 10_801 }, V2_SOURCES);
    health = await buildHealth(NOW);
    expect(health.ok).toBe(false);
    expect(health.keys["active-uniswap-base-grouped:daily:v2"].stale).toBe(true);
  });

  it("reports an archive-only key without letting it decide ok", async () => {
    kvWithAges(60, { "active-quickswap-grouped:v2": 10_801, "active-balancer-grouped:hourly:v2": 10_801 });
    const health = await buildHealth(NOW);

    expect(health.keys["active-quickswap-grouped:v2"]).toMatchObject({ stale: true, gating: false });
    expect(health.keys["active-balancer-grouped:hourly:v2"]).toMatchObject({ stale: true, gating: false });
    expect(health.ok).toBe(true);
  });

  it("gates on the groups with an active pool in pool.json", () => {
    const gating = Object.fromEntries(HEALTH_KEYS.map(({ key, gating }) => [key, gating]));
    expect(gating).toEqual({
      "active-uniswap-base-grouped:hourly:v2": true,
      "active-uniswap-polygon-grouped:hourly:v2": true,
      "active-uniswap-ethereum-grouped:hourly:v2": true,
      "active-balancer-grouped:hourly:v2": false,
      "active-uniswap-base-grouped:daily:v2": true,
      "active-uniswap-polygon-grouped:daily:v2": true,
      "active-uniswap-ethereum-grouped:daily:v2": true,
      "active-balancer-grouped:daily:v2": false,
      "active-quickswap-grouped:v2": false,
      "active-uniswap-polygon-grouped:v3": true,
      "active-uniswap-base-grouped:v3": true,
      "active-uniswap-ethereum-grouped:v3": true,
    });
  });

  it("gates a Uniswap group on the keys of the source it is served from", async () => {
    kvWithAges(60, {}, { "uniswap-base": "v3", "uniswap-polygon": "v2", "uniswap-ethereum": "v2" });
    const health = await buildHealth(NOW);

    expect(health.keys["active-uniswap-base-grouped:v3"].gating).toBe(true);
    expect(health.keys["active-uniswap-base-grouped:hourly:v2"].gating).toBe(false);
    expect(health.keys["active-uniswap-polygon-grouped:hourly:v2"].gating).toBe(true);
    expect(health.keys["active-uniswap-polygon-grouped:v3"].gating).toBe(false);
    expect(health.keys["active-uniswap-ethereum-grouped:hourly:v2"].gating).toBe(true);
    expect(health.keys["active-uniswap-ethereum-grouped:v3"].gating).toBe(false);
  });

  it("gates Base and Ethereum, served from both sources by default, on their v3 keys alone", async () => {
    kvWithAges(60, { "active-uniswap-base-grouped:hourly:v2": 10_801, "active-uniswap-ethereum-grouped:daily:v2": null });
    let health = await buildHealth(NOW);

    for (const chain of ["base", "ethereum"]) {
      expect(health.keys[`active-uniswap-${chain}-grouped:v3`].gating).toBe(true);
      expect(health.keys[`active-uniswap-${chain}-grouped:hourly:v2`].gating).toBe(false);
      expect(health.keys[`active-uniswap-${chain}-grouped:daily:v2`].gating).toBe(false);
    }
    // Stale subgraph keys, which carry only the archived rows, are reported without failing the check.
    expect(health.keys["active-uniswap-base-grouped:hourly:v2"].stale).toBe(true);
    expect(health.ok).toBe(true);

    kvWithAges(60, { "active-uniswap-ethereum-grouped:v3": 901 });
    health = await buildHealth(NOW);
    expect(health.keys["active-uniswap-ethereum-grouped:v3"]).toMatchObject({ stale: true, gating: true });
    expect(health.ok).toBe(false);
  });

  it("serves Polygon from the RPC pipeline by default and applies its chain's lag limit", async () => {
    kvWithAges(60);
    kvMock.hmget.mockImplementation(async (key: string) => ({
      fetchedAt: NOW - 60_000,
      indexedAt: key === "active-uniswap-polygon-grouped:v3" ? NOW - 60_000 - 601_000 : NOW - 90_000,
      hasIndexingErrors: false,
    }));
    const health = await buildHealth(NOW);

    expect(health.keys["active-uniswap-polygon-grouped:v3"]).toMatchObject({ gating: true, lagging: true, indexingLagSeconds: 601 });
    expect(health.keys["active-uniswap-polygon-grouped:hourly:v2"].gating).toBe(false);
    expect(health.ok).toBe(false);
  });

  it("is not ok when a fresh key came from a block more than an hour behind", async () => {
    kvWithAges(60, {}, V2_SOURCES);
    kvMock.hmget.mockImplementation(async (key: string) => ({
      fetchedAt: NOW - 60_000,
      indexedAt: key === "active-uniswap-base-grouped:hourly:v2" ? NOW - 60_000 - 3_601_000 : NOW - 90_000,
      hasIndexingErrors: false,
    }));
    const health = await buildHealth(NOW);

    expect(health.keys["active-uniswap-base-grouped:hourly:v2"]).toMatchObject({ stale: false, lagging: true, indexingLagSeconds: 3601 });
    expect(health.keys["active-uniswap-ethereum-grouped:hourly:v2"].lagging).toBe(false);
    expect(health.ok).toBe(false);
  });

  it("treats a missing key as stale", async () => {
    kvWithAges(60, { "active-uniswap-ethereum-grouped:daily:v2": null }, V2_SOURCES);
    const health = await buildHealth(NOW);

    expect(health.ok).toBe(false);
    expect(health.keys["active-uniswap-ethereum-grouped:daily:v2"]).toMatchObject({
      fetchedAt: null,
      ageSeconds: null,
      indexedAt: null,
      hasIndexingErrors: null,
      stale: true,
    });
  });
});
