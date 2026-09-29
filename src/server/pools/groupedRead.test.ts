/**
 * @jest-environment node
 */
import { DAILY_MAX_AGE_MS, HOURLY_MAX_AGE_MS, QUICKSWAP_MAX_AGE_MS, V3_MAX_AGE_MS, readAllGrouped, v3WindowMaxLagMs } from "./groupedRead";
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

// The server clock for the tests that do not move it: every fixture above is a few seconds old.
const NOW = 3_000;

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

describe("reading one group", () => {
  it("merges the v2 hourly and daily keys", async () => {
    kvWith({
      "active-uniswap-base-grouped:hourly:v2": hourlyHash,
      "active-uniswap-base-grouped:daily:v2": dailyHash,
    });

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: 2_000, indexedAt: 1_900, hasIndexingErrors: false, parts: { legacy: false } });
    expect(typeof body === "object" && body.data).toEqual([
      {
        id: "0xa",
        pool: { id: "0xa" },
        poolSnapshots: [{ periodStartUnix: 1 }],
        threeMonthLiquidityData: [{ timestamp: 1 }],
        metrics: { tvlUSD: 1 },
        rewards: null,
      },
    ]);
  });

  it("does not read the :v1 key", async () => {
    kvWith({ "active-uniswap-base-grouped:hourly:v2": hourlyHash, "active-uniswap-base-grouped:v1": v1Hash });

    await readOne("uniswap-base");

    expect(pipelineMock.hgetall.mock.calls.map(([key]) => key)).toEqual([
      "config:grouped-source",
      "active-uniswap-base-grouped:hourly:v2",
      "active-uniswap-base-grouped:daily:v2",
      "active-uniswap-base-grouped:v3",
      "merkl-rewards:base:v1",
    ]);
  });

  it("serves the hourly part alone with empty history", async () => {
    kvWith({ "active-uniswap-base-grouped:hourly:v2": hourlyHash });

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: 2_000, parts: { daily: null, legacy: false } });
    expect(typeof body === "object" && body.data[0]).toMatchObject({ threeMonthLiquidityData: [], metrics: { tvlUSD: 1 } });
  });

  it("serves the daily part alone with metrics null on every pool when the hourly part is missing", async () => {
    kvWith({ "active-uniswap-ethereum-grouped:daily:v2": dailyHash, "active-uniswap-ethereum-grouped:v1": v1Hash });

    const body = await readOne("uniswap-ethereum");

    expect(body).toMatchObject({ fetchedAt: 1_000, parts: { hourly: null, daily: { fetchedAt: 1_000 }, legacy: false } });
    expect(typeof body === "object" && body.data).toEqual([
      { id: "0xa", pool: { id: "0xa" }, poolSnapshots: [], threeMonthLiquidityData: [{ timestamp: 1 }], metrics: null, rewards: null },
    ]);
  });

  it("is unavailable when only a :v1 key exists", async () => {
    kvWith({ "active-balancer-grouped:v1": v1Hash, "active-quickswap-grouped:v1": v1Hash });

    await expect(readOne("balancer")).resolves.toBe("unavailable");
    await expect(readOne("quickswap")).resolves.toBe("unavailable");
  });

  it("reads QuickSwap's single v2 key without merging", async () => {
    kvWith({ "active-quickswap-grouped:v2": dailyHash });

    const body = await readOne("quickswap");

    expect(pipelineMock.hgetall.mock.calls.map(([key]) => key)).toEqual(["config:grouped-source", "active-quickswap-grouped:v2"]);
    expect(body).toMatchObject({ fetchedAt: 1_000, parts: { hourly: null, daily: { fetchedAt: 1_000 }, legacy: false } });
    expect(typeof body === "object" && body.data).toEqual(dailyHash.data);
  });

  it("is unavailable when nothing is cached", async () => {
    kvWith({});
    await expect(readOne("uniswap-ethereum")).resolves.toBe("unavailable");
  });
});

describe("readAllGrouped", () => {
  it("reads every group the registry fetches, and the Merkl rewards of each Uniswap chain, in one pipelined request", async () => {
    kvWith({});
    const body = await readAllGrouped();

    expect(readRedisMock.pipeline).toHaveBeenCalledTimes(1);
    expect(pipelineMock.exec).toHaveBeenCalledTimes(1);
    expect(pipelineMock.exec).toHaveBeenCalledWith({ keepErrors: true });
    // The source switch, two v2 keys and the v3 key per Uniswap chain, two for Balancer, one for QuickSwap, then rewards.
    expect(pipelineMock.hgetall).toHaveBeenCalledTimes(16);
    expect(pipelineMock.hgetall.mock.calls[0][0]).toBe("config:grouped-source");
    expect(pipelineMock.hgetall.mock.calls.slice(13).map(([key]) => key)).toEqual([
      "merkl-rewards:base:v1",
      "merkl-rewards:polygon:v1",
      "merkl-rewards:ethereum:v1",
    ]);
    expect(Object.keys(body.failed).sort()).toEqual(["balancer", "quickswap", "uniswap-base", "uniswap-ethereum", "uniswap-polygon"]);
  });

  it("makes no request when no group is asked for", async () => {
    kvWith({});
    await expect(readAllGrouped([])).resolves.toEqual({ groups: {}, failed: {} });
    expect(readRedisMock.pipeline).not.toHaveBeenCalled();
  });

  it("returns loaded groups and marks a missing group unavailable and a group with a failed command as an error", async () => {
    kvWith({ "active-quickswap-grouped:v2": dailyHash, "active-balancer-grouped:daily:v2": dailyHash }, ["active-balancer-grouped:hourly:v2"]);

    const body = await readAllGrouped(["quickswap", "balancer", "uniswap-base"]);

    expect(Object.keys(body.groups)).toEqual(["quickswap"]);
    expect(body.failed).toEqual({ balancer: "error", "uniswap-base": "unavailable" });
    expect(JSON.stringify(body)).not.toContain("ERR");
    expect(console.error).toHaveBeenCalledWith(
      "Pool data read failed for balancer",
      expect.stringContaining("ERR active-balancer-grouped:hourly:v2 failed"),
    );
  });

  it("keeps each group's replies apart when an earlier group fails", async () => {
    kvWith(
      {
        "active-uniswap-base-grouped:hourly:v2": hourlyHash,
        "active-uniswap-base-grouped:daily:v2": dailyHash,
        "active-quickswap-grouped:v2": v1Hash,
      },
      ["active-balancer-grouped:daily:v2"],
    );

    const body = await readAllGrouped(["balancer", "uniswap-base", "quickswap"]);

    expect(body.failed).toEqual({ balancer: "error" });
    expect(body.groups["uniswap-base"]).toMatchObject({ fetchedAt: 2_000, parts: { daily: { fetchedAt: 1_000 } } });
    expect(body.groups.quickswap).toMatchObject({ fetchedAt: 500 });
  });

  it("marks every group as an error when the request itself fails", async () => {
    kvWith({});
    pipelineMock.exec.mockRejectedValueOnce(new Error("kv down"));

    const body = await readAllGrouped(["quickswap", "balancer"]);

    expect(body).toEqual({ groups: {}, failed: { quickswap: "error", balancer: "error" } });
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

    kvWith({ "active-uniswap-ethereum-grouped:hourly:v2": hourlyHash });
    expect((await fresh.readAllGrouped(["uniswap-ethereum"])).groups["uniswap-ethereum"]).toBeDefined();

    kvWith({});
    await fresh.readAllGrouped(["uniswap-ethereum"]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("the RPC pipeline's v3 source", () => {
  const v3Hash = {
    fetchedAt: 2_500,
    indexedAt: 2_400,
    hasIndexingErrors: false,
    data: [
      {
        id: "0xa",
        pool: { id: "0xa" },
        poolSnapshots: [{ periodStartUnix: 2 }],
        threeMonthLiquidityData: [{ timestamp: 2 }],
        metrics: { tvlUSD: 2 },
      },
    ],
  };

  it("serves Polygon from its v3 key by default, as both parts, and ignores its v2 keys", async () => {
    kvWith({ "active-uniswap-polygon-grouped:v3": v3Hash, "active-uniswap-polygon-grouped:hourly:v2": hourlyHash });

    const body = await readOne("uniswap-polygon");

    expect(body).toMatchObject({
      fetchedAt: 2_500,
      indexedAt: 2_400,
      parts: { hourly: { fetchedAt: 2_500 }, daily: { fetchedAt: 2_500 }, legacy: false },
    });
    expect(typeof body === "object" && body.data).toEqual([{ ...v3Hash.data[0], rewards: null }]);
  });

  it("is unavailable, not the v2 data, while the v3 key is missing", async () => {
    kvWith({ "active-uniswap-polygon-grouped:hourly:v2": hourlyHash });
    await expect(readOne("uniswap-polygon")).resolves.toBe("unavailable");
  });

  it("follows config:grouped-source in both directions", async () => {
    kvWith({
      "config:grouped-source": { "uniswap-polygon": "v2", "uniswap-base": "v3", balancer: "v3" },
      "active-uniswap-polygon-grouped:hourly:v2": hourlyHash,
      "active-uniswap-polygon-grouped:v3": v3Hash,
      "active-uniswap-base-grouped:hourly:v2": hourlyHash,
      "active-uniswap-base-grouped:v3": v3Hash,
      "active-balancer-grouped:hourly:v2": hourlyHash,
    });

    const body = await readAllGrouped(["uniswap-polygon", "uniswap-base", "balancer"]);

    expect(body.groups["uniswap-polygon"]?.fetchedAt).toBe(2_000);
    expect(body.groups["uniswap-base"]?.fetchedAt).toBe(2_500);
    expect(body.groups.balancer?.fetchedAt).toBe(2_000);
  });

  it("uses the default sources when the switch read fails, and still loads the groups", async () => {
    kvWith({ "active-uniswap-polygon-grouped:v3": v3Hash, "active-uniswap-base-grouped:hourly:v2": hourlyHash }, ["config:grouped-source"]);

    const body = await readAllGrouped(["uniswap-polygon", "uniswap-base"]);

    expect(body.groups["uniswap-polygon"]?.fetchedAt).toBe(2_500);
    expect(body.groups["uniswap-base"]?.fetchedAt).toBe(2_000);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("config:grouped-source"), expect.anything());
  });

  it("fails a group only on the keys of its source", async () => {
    kvWith({ "active-uniswap-polygon-grouped:v3": v3Hash }, ["active-uniswap-polygon-grouped:hourly:v2", "active-uniswap-base-grouped:v3"]);
    const body = await readAllGrouped(["uniswap-polygon", "uniswap-base"]);

    expect(body.groups["uniswap-polygon"]?.fetchedAt).toBe(2_500);
    expect(body.failed).toEqual({ "uniswap-base": "unavailable" });
  });

  it("withholds the 24h values once the data trails the clock by more than the chain's limit, and keeps TVL and rows", async () => {
    const now = 1_758_900_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);
    const metrics = { tvlUSD: 2, volume24h: 10, fees24h: 0.03, window: "trailing-24h" };
    const payload = (indexedAt: number | null) => ({
      ...v3Hash,
      fetchedAt: now - 60_000,
      indexedAt,
      data: [{ ...v3Hash.data[0], metrics }],
    });

    kvWith({ "active-uniswap-polygon-grouped:v3": payload(now - v3WindowMaxLagMs("polygon")) });
    const inTime = await readOne("uniswap-polygon");
    expect(typeof inTime === "object" && inTime.data[0].metrics).toEqual(metrics);

    for (const indexedAt of [now - v3WindowMaxLagMs("polygon") - 1, null]) {
      kvWith({ "active-uniswap-polygon-grouped:v3": payload(indexedAt) });
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
    const now = 1_758_900_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);

    kvWith({ "active-uniswap-polygon-grouped:v3": { ...v3Hash, fetchedAt: now - V3_MAX_AGE_MS } });
    await expect(readOne("uniswap-polygon")).resolves.toMatchObject({ fetchedAt: now - V3_MAX_AGE_MS });

    kvWith({ "active-uniswap-polygon-grouped:v3": { ...v3Hash, fetchedAt: now - V3_MAX_AGE_MS - 1 } });
    await expect(readOne("uniswap-polygon")).resolves.toBe("unavailable");
  });
});

describe("age limits", () => {
  const now = 1_758_900_000_000;
  const at = (hash: typeof hourlyHash | typeof dailyHash, fetchedAt: number) => ({ ...hash, fetchedAt });
  const baseKeys = (hourlyAge: number, dailyAge: number) => ({
    "active-uniswap-base-grouped:hourly:v2": at(hourlyHash, now - hourlyAge),
    "active-uniswap-base-grouped:daily:v2": at(dailyHash, now - dailyAge),
  });

  beforeEach(() => {
    (Date.now as jest.Mock).mockReturnValue(now);
  });

  it("serves an hourly part exactly at its limit with its metrics", async () => {
    kvWith(baseKeys(HOURLY_MAX_AGE_MS, 0));

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: now - HOURLY_MAX_AGE_MS, parts: { hourly: { fetchedAt: now - HOURLY_MAX_AGE_MS } } });
    expect(typeof body === "object" && body.data[0]).toMatchObject({ poolSnapshots: [{ periodStartUnix: 1 }], metrics: { tvlUSD: 1 } });
  });

  it("drops an hourly part past its limit, so every pool has metrics null and freshness comes from the daily part", async () => {
    kvWith(baseKeys(HOURLY_MAX_AGE_MS + 1, 60_000));

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: now - 60_000, parts: { hourly: null, daily: { fetchedAt: now - 60_000 } } });
    expect(typeof body === "object" && body.data).toEqual([
      { id: "0xa", pool: { id: "0xa" }, poolSnapshots: [], threeMonthLiquidityData: [{ timestamp: 1 }], metrics: null, rewards: null },
    ]);
  });

  it("serves a daily part exactly at its limit and drops it past the limit", async () => {
    kvWith(baseKeys(0, DAILY_MAX_AGE_MS));
    expect(await readOne("uniswap-base")).toMatchObject({ parts: { daily: { fetchedAt: now - DAILY_MAX_AGE_MS } } });

    kvWith(baseKeys(0, DAILY_MAX_AGE_MS + 1));
    const body = await readOne("uniswap-base");
    expect(body).toMatchObject({ fetchedAt: now, parts: { hourly: { fetchedAt: now }, daily: null } });
    expect(typeof body === "object" && body.data[0]).toMatchObject({ threeMonthLiquidityData: [], metrics: { tvlUSD: 1 } });
  });

  it("marks a group unavailable when both parts are past their limits", async () => {
    kvWith(baseKeys(HOURLY_MAX_AGE_MS + 1, DAILY_MAX_AGE_MS + 1));
    await expect(readOne("uniswap-base")).resolves.toBe("unavailable");
  });

  it("serves the QuickSwap key exactly at its limit and marks it unavailable past the limit", async () => {
    kvWith({ "active-quickswap-grouped:v2": at(dailyHash, now - QUICKSWAP_MAX_AGE_MS) });
    expect(await readOne("quickswap")).toMatchObject({ fetchedAt: now - QUICKSWAP_MAX_AGE_MS });

    kvWith({ "active-quickswap-grouped:v2": at(dailyHash, now - QUICKSWAP_MAX_AGE_MS - 1) });
    await expect(readOne("quickswap")).resolves.toBe("unavailable");
  });

  it("serves a part stamped slightly ahead of the server clock", async () => {
    kvWith(baseKeys(-5_000, -5_000));
    expect(await readOne("uniswap-base")).toMatchObject({ fetchedAt: now + 5_000 });
  });

  it("checks every group against one clock reading", async () => {
    kvWith({ ...baseKeys(HOURLY_MAX_AGE_MS, DAILY_MAX_AGE_MS), "active-quickswap-grouped:v2": at(dailyHash, now - QUICKSWAP_MAX_AGE_MS) });
    (Date.now as jest.Mock).mockReturnValueOnce(now).mockReturnValue(now + 60_000);

    const body = await readAllGrouped(["uniswap-base", "quickswap"]);

    expect(body.failed).toEqual({});
    expect(body.groups["uniswap-base"]?.parts.hourly).not.toBeNull();
    expect(Date.now).toHaveBeenCalledTimes(1);
  });
});
