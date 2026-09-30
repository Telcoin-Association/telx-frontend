/**
 * @jest-environment node
 */
import { V3_MAX_AGE_MS, readAllGrouped, v3WindowMaxLagMs } from "./groupedRead";
import type { Group } from "./registry";

/**
 * A pipeline double for the read client. `hgetall` queues a key and `exec` answers every queued key as
 * Upstash does with `keepErrors`: `{ result }` holding the raw `[field, value, ...]` reply (empty for a
 * missing key), or `{ error }` for a key listed in `failing`.
 */
const pipelineMock = { hgetall: jest.fn(), exec: jest.fn() };
const readRedisMock = { pipeline: jest.fn() };
jest.mock("./redis", () => ({ getPoolsReadRedis: () => readRedisMock }));

/** Flattens a hash into the raw reply Redis returns: every value is stored as a string. */
const rawReply = (hash: Record<string, unknown>) =>
  Object.entries(hash).flatMap(([field, value]) => [field, typeof value === "string" ? value : JSON.stringify(value)]);

function kvWith(hashes: Record<string, Record<string, unknown>>, failing: string[] = []) {
  const keys: string[] = [];
  pipelineMock.hgetall.mockImplementation((key: string) => {
    keys.push(key);
    return pipelineMock;
  });
  pipelineMock.exec.mockImplementation(async () =>
    keys.map(key => (failing.includes(key) ? { error: `ERR ${key} failed`, result: undefined } : { result: rawReply(hashes[key] ?? {}) })),
  );
  readRedisMock.pipeline.mockImplementation(() => {
    keys.length = 0;
    return pipelineMock;
  });
}

const NOW = 1_758_900_000_000;

const v3Hash = (fetchedAt = NOW - 60_000, indexedAt: number | null = NOW - 120_000) => ({
  fetchedAt,
  indexedAt,
  hasIndexingErrors: false,
  data: [
    {
      id: "0xa",
      pool: { id: "0xa" },
      poolSnapshots: [{ periodStartUnix: 2 }],
      threeMonthLiquidityData: [{ timestamp: 2 }],
      metrics: { tvlUSD: 2, volume24h: 10, fees24h: 0.03, window: "trailing-24h" },
    },
  ],
});

/** Reads one group and returns its response, or its failure. */
async function readOne(group: Group) {
  const body = await readAllGrouped([group]);
  return body.groups[group] ?? body.failed[group];
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readAllGrouped", () => {
  it("reads each chain's v3 key and its Merkl rewards in one pipelined request", async () => {
    kvWith({});
    const body = await readAllGrouped();

    expect(readRedisMock.pipeline).toHaveBeenCalledTimes(1);
    expect(pipelineMock.exec).toHaveBeenCalledWith({ keepErrors: true });
    expect(pipelineMock.hgetall.mock.calls.map(([key]) => key)).toEqual([
      "active-uniswap-base-grouped:v3",
      "active-uniswap-polygon-grouped:v3",
      "active-uniswap-ethereum-grouped:v3",
      "merkl-rewards:base:v1",
      "merkl-rewards:polygon:v1",
      "merkl-rewards:ethereum:v1",
    ]);
    expect(Object.keys(body.failed).sort()).toEqual(["uniswap-base", "uniswap-ethereum", "uniswap-polygon"]);
  });

  it("makes no request when no group is asked for", async () => {
    kvWith({});
    await expect(readAllGrouped([])).resolves.toEqual({ groups: {}, failed: {} });
    expect(readRedisMock.pipeline).not.toHaveBeenCalled();
  });

  it("serves a group from its v3 key, with the key's freshness as both parts", async () => {
    const hash = v3Hash();
    kvWith({ "active-uniswap-polygon-grouped:v3": hash });

    const meta = { fetchedAt: hash.fetchedAt, indexedAt: hash.indexedAt, hasIndexingErrors: false };
    await expect(readOne("uniswap-polygon")).resolves.toEqual({
      ...meta,
      parts: { hourly: meta, daily: meta, legacy: false },
      // No rewards are cached here, so they are unknown: no `rewards` field, and the group says so.
      data: hash.data,
      rewardsUnavailable: true,
    });
  });

  it("marks a missing group unavailable and a group with a failed read as an error, keeping the others", async () => {
    kvWith({ "active-uniswap-base-grouped:v3": v3Hash() }, ["active-uniswap-polygon-grouped:v3"]);

    const body = await readAllGrouped(["uniswap-polygon", "uniswap-base", "uniswap-ethereum"]);

    expect(Object.keys(body.groups)).toEqual(["uniswap-base"]);
    expect(body.failed).toEqual({ "uniswap-polygon": "error", "uniswap-ethereum": "unavailable" });
    expect(JSON.stringify(body)).not.toContain("ERR");
    expect(console.error).toHaveBeenCalledWith("Pool data read failed for uniswap-polygon", "ERR active-uniswap-polygon-grouped:v3 failed");
  });

  it("marks every group as an error when the request itself fails", async () => {
    kvWith({});
    pipelineMock.exec.mockRejectedValueOnce(new Error("kv down"));

    const body = await readAllGrouped(["uniswap-base", "uniswap-polygon"]);

    expect(body).toEqual({ groups: {}, failed: { "uniswap-base": "error", "uniswap-polygon": "error" } });
    expect(JSON.stringify(body)).not.toContain("kv down");
  });

  it("logs a group with no cached data once per instance, and again only after it has loaded in between", async () => {
    let fresh!: typeof import("./groupedRead");
    await jest.isolateModulesAsync(async () => {
      fresh = await import("./groupedRead");
    });
    const warn = console.warn as jest.Mock;

    kvWith({});
    await fresh.readAllGrouped(["uniswap-ethereum"]);
    await fresh.readAllGrouped(["uniswap-ethereum"]);
    expect(warn).toHaveBeenCalledTimes(1);

    kvWith({ "active-uniswap-ethereum-grouped:v3": v3Hash() });
    expect((await fresh.readAllGrouped(["uniswap-ethereum"])).groups["uniswap-ethereum"]).toBeDefined();

    kvWith({});
    await fresh.readAllGrouped(["uniswap-ethereum"]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("age limits", () => {
  it("withholds the 24h values once the data trails the clock by more than the chain's limit, and keeps TVL and rows", async () => {
    const inTime = v3Hash(NOW - 60_000, NOW - v3WindowMaxLagMs("polygon"));
    kvWith({ "active-uniswap-polygon-grouped:v3": inTime });
    const served = await readOne("uniswap-polygon");
    expect(typeof served === "object" && served.data[0].metrics).toEqual(inTime.data[0].metrics);

    for (const indexedAt of [NOW - v3WindowMaxLagMs("polygon") - 1, null]) {
      kvWith({ "active-uniswap-polygon-grouped:v3": v3Hash(NOW - 60_000, indexedAt) });
      const late = await readOne("uniswap-polygon");
      expect(typeof late === "object" && late.data[0]).toMatchObject({
        metrics: { tvlUSD: 2, volume24h: null, fees24h: null, window: null },
        threeMonthLiquidityData: [{ timestamp: 2 }],
      });
    }
    // Base's finalized block trails by about 21 minutes, so its limit is wider than Polygon's.
    expect(v3WindowMaxLagMs("base")).toBeGreaterThan(v3WindowMaxLagMs("polygon"));
  });

  it("serves the v3 key up to its age limit and not past it", async () => {
    kvWith({ "active-uniswap-polygon-grouped:v3": v3Hash(NOW - V3_MAX_AGE_MS) });
    await expect(readOne("uniswap-polygon")).resolves.toMatchObject({ fetchedAt: NOW - V3_MAX_AGE_MS });

    kvWith({ "active-uniswap-polygon-grouped:v3": v3Hash(NOW - V3_MAX_AGE_MS - 1) });
    await expect(readOne("uniswap-polygon")).resolves.toBe("unavailable");
  });

  it("serves a payload stamped slightly ahead of the server clock", async () => {
    kvWith({ "active-uniswap-base-grouped:v3": v3Hash(NOW + 5_000, NOW) });
    await expect(readOne("uniswap-base")).resolves.toMatchObject({ fetchedAt: NOW + 5_000 });
  });

  it("checks every group against one clock reading", async () => {
    kvWith({
      "active-uniswap-base-grouped:v3": v3Hash(NOW - V3_MAX_AGE_MS),
      "active-uniswap-polygon-grouped:v3": v3Hash(NOW - V3_MAX_AGE_MS),
    });
    (Date.now as jest.Mock).mockReturnValueOnce(NOW).mockReturnValue(NOW + 60_000);

    const body = await readAllGrouped(["uniswap-base", "uniswap-polygon"]);

    expect(body.failed).toEqual({});
    expect(Date.now).toHaveBeenCalledTimes(1);
  });
});
