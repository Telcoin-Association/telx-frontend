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

/** Serves Base and Ethereum from their subgraph keys alone, for the tests of the v2 read path. */
const V2_SOURCES = { "config:grouped-source": { "uniswap-base": "v2", "uniswap-ethereum": "v2" } };

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
      ...V2_SOURCES,
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
    kvWith({ ...V2_SOURCES, "active-uniswap-base-grouped:hourly:v2": hourlyHash });

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: 2_000, parts: { daily: null, legacy: false } });
    expect(typeof body === "object" && body.data[0]).toMatchObject({ threeMonthLiquidityData: [], metrics: { tvlUSD: 1 } });
  });

  it("serves the daily part alone with metrics null on every pool when the hourly part is missing", async () => {
    kvWith({ ...V2_SOURCES, "active-uniswap-ethereum-grouped:daily:v2": dailyHash, "active-uniswap-ethereum-grouped:v1": v1Hash });

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
        ...V2_SOURCES,
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
    kvWith({ ...V2_SOURCES, "active-uniswap-polygon-grouped:v3": v3Hash }, [
      "active-uniswap-polygon-grouped:hourly:v2",
      "active-uniswap-base-grouped:v3",
    ]);
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
    ...V2_SOURCES,
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

describe("the mixed source", () => {
  const now = 1_758_900_000_000;
  // Base in pool.json: ETH/TEL and eUSD/TEL are active, the two TEL/ETH pools archived.
  const ETH_TEL = "0x272e0968e2fb347236c6060cc9395f13591968f3f83056c600c755066dd214a6";
  const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
  const ARCHIVED_A = "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b";
  const ARCHIVED_B = "0xb6d004fca4f9a34197862176485c45ceab7117c86f07422d1fe3d9cfd6e9d1da";
  // Ethereum's archived eUSD/TEL; its active pools share Base's ids.
  const ETHEREUM_ARCHIVED = "0xd6771c30706f7933f3b1b1ac83f2f82c58673f556157e0414b1968702a5088d0";

  const metrics = (tvlUSD: number) => ({ tvlUSD, volume24h: 10, fees24h: 0.03, window: "trailing-24h" });
  const v3Row = (id: string, tvlUSD: number) => ({
    id,
    pool: { id },
    poolSnapshots: [{ periodStartUnix: 3 }],
    threeMonthLiquidityData: [{ timestamp: 3 }],
    metrics: metrics(tvlUSD),
  });
  const v3 = (age = 60_000, data = [v3Row(ETH_TEL, 69_500), v3Row(EUSD_TEL, 40_000)]) => ({
    fetchedAt: now - age,
    indexedAt: now - age - 30_000,
    hasIndexingErrors: false,
    data,
  });
  const v2Hourly = {
    fetchedAt: now - 120_000,
    indexedAt: now - 150_000,
    hasIndexingErrors: true,
    data: [ETH_TEL, ARCHIVED_A, ARCHIVED_B].map(id => ({ id, pool: { id }, poolSnapshots: [{ periodStartUnix: 1 }], metrics: metrics(11.96) })),
  };
  const v2Daily = {
    fetchedAt: now - 1_800_000,
    indexedAt: now - 1_830_000,
    hasIndexingErrors: false,
    data: [ETH_TEL, ARCHIVED_A, ARCHIVED_B].map(id => ({ id, pool: { id }, threeMonthLiquidityData: [{ timestamp: 1 }] })),
  };
  const baseKeys = (overrides: Record<string, Record<string, unknown> | undefined> = {}) => {
    const hashes: Record<string, Record<string, unknown>> = {
      "active-uniswap-base-grouped:v3": v3(),
      "active-uniswap-base-grouped:hourly:v2": v2Hourly,
      "active-uniswap-base-grouped:daily:v2": v2Daily,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete hashes[key];
      else hashes[key] = value;
    }
    return hashes;
  };
  const archivedRow = (id: string) => ({
    id,
    pool: { id },
    poolSnapshots: [{ periodStartUnix: 1 }],
    threeMonthLiquidityData: [{ timestamp: 1 }],
    metrics: metrics(11.96),
    rewards: null,
  });
  const unavailableRow = (id: string) => ({ id, pool: null, poolSnapshots: [], threeMonthLiquidityData: [], metrics: null, rewards: null });

  beforeEach(() => {
    (Date.now as jest.Mock).mockReturnValue(now);
  });

  it("serves the active pools from the v3 key and the archived pools from the v2 keys, keeping the v3 row of a pool in both", async () => {
    kvWith(baseKeys());

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({
      fetchedAt: now - 60_000,
      indexedAt: now - 90_000,
      hasIndexingErrors: false,
      parts: {
        hourly: { fetchedAt: now - 60_000 },
        daily: { fetchedAt: now - 60_000 },
        legacy: false,
        archived: { hourly: { fetchedAt: now - 120_000, hasIndexingErrors: true }, daily: { fetchedAt: now - 1_800_000 } },
      },
    });
    expect(typeof body === "object" && body.data).toEqual([
      { ...v3Row(ETH_TEL, 69_500), rewards: null },
      { ...v3Row(EUSD_TEL, 40_000), rewards: null },
      archivedRow(ARCHIVED_A),
      archivedRow(ARCHIVED_B),
    ]);
  });

  it("is the default for Base and Ethereum", async () => {
    kvWith({
      ...baseKeys(),
      "active-uniswap-ethereum-grouped:v3": v3(60_000, [v3Row(EUSD_TEL, 40_000)]),
      "active-uniswap-ethereum-grouped:hourly:v2": { ...v2Hourly, data: [v2Hourly.data[0], { ...v2Hourly.data[1], id: ETHEREUM_ARCHIVED }] },
    });

    const body = await readAllGrouped(["uniswap-base", "uniswap-ethereum"]);

    expect(body.groups["uniswap-base"]?.parts.archived).toBeDefined();
    // Ethereum's ETH/TEL is active but missing from this v3 payload, so it is unavailable rather than taken from v2.
    expect(body.groups["uniswap-ethereum"]?.data.map(pool => [pool.id, pool.metrics?.tvlUSD ?? null])).toEqual([
      [ETH_TEL, null],
      [EUSD_TEL, 40_000],
      [ETHEREUM_ARCHIVED, 11.96],
    ]);
  });

  it("withholds the v3 part's 24h values past the chain's lag limit and leaves the archived rows alone", async () => {
    kvWith(baseKeys({ "active-uniswap-base-grouped:v3": { ...v3(), indexedAt: now - v3WindowMaxLagMs("base") - 1 } }));

    const body = await readOne("uniswap-base");

    expect(typeof body === "object" && body.data.map(pool => pool.metrics)).toEqual([
      { tvlUSD: 69_500, volume24h: null, fees24h: null, window: null },
      { tvlUSD: 40_000, volume24h: null, fees24h: null, window: null },
      metrics(11.96),
      metrics(11.96),
    ]);
  });

  it("serves the active pools as unavailable and keeps the archived rows when the v3 key is past its age limit, dated by the v3 key", async () => {
    kvWith(baseKeys({ "active-uniswap-base-grouped:v3": v3(V3_MAX_AGE_MS + 1) }));

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({
      fetchedAt: now - V3_MAX_AGE_MS - 1,
      parts: { hourly: null, daily: null, archived: { hourly: { fetchedAt: now - 120_000 } } },
    });
    expect(typeof body === "object" && body.data).toEqual([
      unavailableRow(ETH_TEL),
      unavailableRow(EUSD_TEL),
      archivedRow(ARCHIVED_A),
      archivedRow(ARCHIVED_B),
    ]);
  });

  it("dates the group by the archived part when the v3 key is missing", async () => {
    kvWith(baseKeys({ "active-uniswap-base-grouped:v3": undefined }));

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: now - 120_000, hasIndexingErrors: true, parts: { hourly: null, daily: null } });
    expect(typeof body === "object" && body.data.map(pool => pool.id)).toEqual([ETH_TEL, EUSD_TEL, ARCHIVED_A, ARCHIVED_B]);
    expect(typeof body === "object" && body.data[0].metrics).toBeNull();
  });

  it("serves the active pools alone when the v2 keys are missing or past their limits", async () => {
    for (const overrides of [
      { "active-uniswap-base-grouped:hourly:v2": undefined, "active-uniswap-base-grouped:daily:v2": undefined },
      {
        "active-uniswap-base-grouped:hourly:v2": { ...v2Hourly, fetchedAt: now - HOURLY_MAX_AGE_MS - 1 },
        "active-uniswap-base-grouped:daily:v2": { ...v2Daily, fetchedAt: now - DAILY_MAX_AGE_MS - 1 },
      },
    ]) {
      kvWith(baseKeys(overrides));
      const body = await readOne("uniswap-base");
      expect(body).toMatchObject({ fetchedAt: now - 60_000, parts: { archived: { hourly: null, daily: null } } });
      expect(typeof body === "object" && body.data.map(pool => pool.id)).toEqual([ETH_TEL, EUSD_TEL]);
    }
  });

  it("gives archived rows metrics null once the v2 hourly part is past its limit, as the v2 source does", async () => {
    kvWith(baseKeys({ "active-uniswap-base-grouped:hourly:v2": { ...v2Hourly, fetchedAt: now - HOURLY_MAX_AGE_MS - 1 } }));

    const body = await readOne("uniswap-base");

    expect(typeof body === "object" && body.data[2]).toEqual({ ...archivedRow(ARCHIVED_A), poolSnapshots: [], metrics: null });
  });

  it("is unavailable when neither part has fresh data", async () => {
    kvWith(
      baseKeys({
        "active-uniswap-base-grouped:hourly:v2": undefined,
        "active-uniswap-base-grouped:daily:v2": undefined,
        "active-uniswap-base-grouped:v3": v3(V3_MAX_AGE_MS + 1),
      }),
    );
    await expect(readOne("uniswap-base")).resolves.toBe("unavailable");

    kvWith({});
    await expect(readOne("uniswap-base")).resolves.toBe("unavailable");
  });

  it("fails the group when its v3 read fails, and only drops the archived rows' hourly part when a v2 read fails", async () => {
    kvWith(baseKeys(), ["active-uniswap-base-grouped:v3"]);
    await expect(readOne("uniswap-base")).resolves.toBe("error");

    kvWith(baseKeys(), ["active-uniswap-base-grouped:hourly:v2"]);
    const body = await readOne("uniswap-base");
    expect(typeof body === "object" && body.data.map(pool => pool.id)).toEqual([ETH_TEL, EUSD_TEL, ARCHIVED_A, ARCHIVED_B]);
    expect(typeof body === "object" && body.data[0].metrics?.tvlUSD).toBe(69_500);
    expect(typeof body === "object" && body.data[2].metrics).toBeNull();
    expect(console.error).toHaveBeenCalledWith("Archived pool data read failed for uniswap-base", expect.stringContaining("ERR"));
    expect(JSON.stringify(body)).not.toContain("ERR");
  });

  it("serves Polygon's active pools from v3 and nothing archived, since its v2 keys are empty", async () => {
    const polygonActive = [
      "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d",
      "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982",
      "0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135",
    ];
    kvWith({
      "config:grouped-source": { "uniswap-polygon": "mixed" },
      "active-uniswap-polygon-grouped:v3": v3(
        60_000,
        polygonActive.map(id => v3Row(id, 1)),
      ),
    });

    const body = await readOne("uniswap-polygon");

    expect(body).toMatchObject({ fetchedAt: now - 60_000, parts: { archived: { hourly: null, daily: null } } });
    expect(typeof body === "object" && body.data).toEqual(polygonActive.map(id => ({ ...v3Row(id, 1), rewards: null })));
  });

  it("rolls back to the v2 keys for every pool with config:grouped-source", async () => {
    kvWith({ ...baseKeys(), "config:grouped-source": { "uniswap-base": "v2" } });

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: now - 120_000, parts: { hourly: { fetchedAt: now - 120_000 } } });
    expect(typeof body === "object" && body.parts.archived).toBeUndefined();
    expect(typeof body === "object" && body.data.map(pool => [pool.id, pool.metrics?.tvlUSD])).toEqual([
      [ETH_TEL, 11.96],
      [ARCHIVED_A, 11.96],
      [ARCHIVED_B, 11.96],
    ]);
  });
});
