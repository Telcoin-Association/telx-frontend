/**
 * @jest-environment node
 */
import { readAllGrouped } from "./groupedRead";
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

/** Reads one group and returns its response, or its failure. */
async function readOne(group: Group) {
  const body = await readAllGrouped([group]);
  return body.groups[group] ?? body.failed[group];
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
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
      },
    ]);
  });

  it("does not read the :v1 key", async () => {
    kvWith({ "active-uniswap-base-grouped:hourly:v2": hourlyHash, "active-uniswap-base-grouped:v1": v1Hash });

    await readOne("uniswap-base");

    expect(pipelineMock.hgetall.mock.calls.map(([key]) => key)).toEqual([
      "active-uniswap-base-grouped:hourly:v2",
      "active-uniswap-base-grouped:daily:v2",
    ]);
  });

  it("serves the hourly part alone with empty history", async () => {
    kvWith({ "active-uniswap-base-grouped:hourly:v2": hourlyHash });

    const body = await readOne("uniswap-base");

    expect(body).toMatchObject({ fetchedAt: 2_000, parts: { daily: null, legacy: false } });
    expect(typeof body === "object" && body.data[0]).toMatchObject({ threeMonthLiquidityData: [], metrics: { tvlUSD: 1 } });
  });

  it("serves the daily part alone with metrics null on every pool when the hourly part is missing", async () => {
    kvWith({ "active-uniswap-polygon-grouped:daily:v2": dailyHash, "active-uniswap-polygon-grouped:v1": v1Hash });

    const body = await readOne("uniswap-polygon");

    expect(body).toMatchObject({ fetchedAt: 1_000, parts: { hourly: null, daily: { fetchedAt: 1_000 }, legacy: false } });
    expect(typeof body === "object" && body.data).toEqual([
      { id: "0xa", pool: { id: "0xa" }, poolSnapshots: [], threeMonthLiquidityData: [{ timestamp: 1 }], metrics: null },
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

    expect(pipelineMock.hgetall.mock.calls.map(([key]) => key)).toEqual(["active-quickswap-grouped:v2"]);
    expect(body).toMatchObject({ fetchedAt: 1_000, parts: { hourly: null, daily: { fetchedAt: 1_000 }, legacy: false } });
    expect(typeof body === "object" && body.data).toEqual(dailyHash.data);
  });

  it("is unavailable when nothing is cached", async () => {
    kvWith({});
    await expect(readOne("uniswap-ethereum")).resolves.toBe("unavailable");
  });
});

describe("readAllGrouped", () => {
  it("reads every group the registry fetches in one pipelined request", async () => {
    kvWith({});
    const body = await readAllGrouped();

    expect(readRedisMock.pipeline).toHaveBeenCalledTimes(1);
    expect(pipelineMock.exec).toHaveBeenCalledTimes(1);
    expect(pipelineMock.exec).toHaveBeenCalledWith({ keepErrors: true });
    expect(pipelineMock.hgetall).toHaveBeenCalledTimes(9);
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
    await fresh.readAllGrouped(["uniswap-polygon"]);
    await fresh.readAllGrouped(["uniswap-polygon"]);
    expect(warn).toHaveBeenCalledTimes(1);

    kvWith({ "active-uniswap-polygon-grouped:hourly:v2": hourlyHash });
    expect((await fresh.readAllGrouped(["uniswap-polygon"])).groups["uniswap-polygon"]).toBeDefined();

    kvWith({});
    await fresh.readAllGrouped(["uniswap-polygon"]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
