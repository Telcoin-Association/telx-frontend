/**
 * @jest-environment node
 */
import { readAllGrouped, readGrouped } from "./groupedRead";
import { fakeRedis } from "./testing";

const kvMock = fakeRedis();
jest.mock("./redis", () => ({ getRedis: () => kvMock }));

/** Serves hgetall from a plain object of hashes, as the client returns them after parsing. */
function kvWith(hashes: Record<string, Record<string, unknown>>) {
  kvMock.hgetall.mockImplementation(async (key: string) => hashes[key] ?? null);
}

const hourlyHash = {
  fetchedAt: 2_000,
  indexedAt: 1_900,
  hasIndexingErrors: false,
  data: [{ id: "0xa", pool: { id: "0xa" }, poolSnapshots: [{ periodStartUnix: 1 }], metrics: { tvlUSD: 1 } }],
};
const dailyHash = {
  fetchedAt: 1_000,
  indexedAt: 900,
  hasIndexingErrors: false,
  data: [{ id: "0xa", pool: { id: "0xa" }, threeMonthLiquidityData: [{ timestamp: 1 }] }],
};
const v1Hash = {
  fetchedAt: 500,
  data: [{ id: "0xa", pool: { id: "0xa" }, poolSnapshots: [], threeMonthLiquidityData: [{ timestamp: 0 }] }],
};

describe("readGrouped", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("merges the v2 hourly and daily keys", async () => {
    kvWith({
      "active-uniswap-base-grouped:hourly:v2": hourlyHash,
      "active-uniswap-base-grouped:daily:v2": dailyHash,
    });

    const body = await readGrouped("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: 2_000, indexedAt: 1_900, hasIndexingErrors: false, parts: { legacy: false } });
    expect(body?.data).toEqual([
      {
        id: "0xa",
        pool: { id: "0xa" },
        poolSnapshots: [{ periodStartUnix: 1 }],
        threeMonthLiquidityData: [{ timestamp: 1 }],
        metrics: { tvlUSD: 1 },
      },
    ]);
  });

  it("never reads the old :v1 key", async () => {
    kvWith({ "active-uniswap-base-grouped:hourly:v2": hourlyHash, "active-uniswap-base-grouped:v1": v1Hash });

    await readGrouped("uniswap-base");

    expect(kvMock.hgetall.mock.calls.map(([key]) => key).sort()).toEqual([
      "active-uniswap-base-grouped:daily:v2",
      "active-uniswap-base-grouped:hourly:v2",
    ]);
  });

  it("serves the hourly part alone with empty history", async () => {
    kvWith({ "active-uniswap-base-grouped:hourly:v2": hourlyHash });

    const body = await readGrouped("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: 2_000, parts: { daily: null, legacy: false } });
    expect(body?.data[0]).toMatchObject({ threeMonthLiquidityData: [], metrics: { tvlUSD: 1 } });
  });

  it("serves the daily part alone with metrics null on every pool when the hourly part is missing", async () => {
    kvWith({ "active-uniswap-polygon-grouped:daily:v2": dailyHash, "active-uniswap-polygon-grouped:v1": v1Hash });

    const body = await readGrouped("uniswap-polygon");

    expect(body).toMatchObject({ fetchedAt: 1_000, parts: { hourly: null, daily: { fetchedAt: 1_000 }, legacy: false } });
    expect(body?.data).toEqual([{ id: "0xa", pool: { id: "0xa" }, poolSnapshots: [], threeMonthLiquidityData: [{ timestamp: 1 }], metrics: null }]);
  });

  it("returns null when only the old :v1 key exists", async () => {
    kvWith({ "active-balancer-grouped:v1": v1Hash, "active-quickswap-grouped:v1": v1Hash });

    await expect(readGrouped("balancer")).resolves.toBeNull();
    await expect(readGrouped("quickswap")).resolves.toBeNull();
  });

  it("reads QuickSwap's single v2 key without merging", async () => {
    kvWith({ "active-quickswap-grouped:v2": dailyHash });

    const body = await readGrouped("quickswap");

    expect(body).toMatchObject({ fetchedAt: 1_000, parts: { hourly: null, daily: { fetchedAt: 1_000 }, legacy: false } });
    expect(body?.data).toEqual(dailyHash.data);
  });

  it("returns null when nothing is cached", async () => {
    kvWith({});
    await expect(readGrouped("uniswap-ethereum")).resolves.toBeNull();
  });
});

describe("readAllGrouped", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads every group the registry fetches", async () => {
    kvWith({});
    const body = await readAllGrouped();

    expect(Object.keys(body.failed).sort()).toEqual(["balancer", "quickswap", "uniswap-base", "uniswap-ethereum", "uniswap-polygon"]);
  });

  it("returns loaded groups and marks a missing group unavailable and a throwing group as an error", async () => {
    kvMock.hgetall.mockImplementation(async (key: string) => {
      if (key.startsWith("active-balancer")) throw new Error("kv down");
      return key === "active-quickswap-grouped:v2" ? dailyHash : null;
    });

    const body = await readAllGrouped(["quickswap", "balancer", "uniswap-base"]);

    expect(Object.keys(body.groups)).toEqual(["quickswap"]);
    expect(body.failed).toEqual({ balancer: "error", "uniswap-base": "unavailable" });
    expect(JSON.stringify(body)).not.toContain("kv down");
  });
});
