/**
 * @jest-environment node
 */
import { GET } from "../../../app/api/pools/route";
import { readAllGrouped } from "../groupedRead";
import { REWARDS_MAX_AGE_MS } from "./store";

/**
 * The /api/pools read path with Merkl rewards: a pipeline double that answers each queued `hgetall` as
 * Upstash does with `keepErrors`, a raw `[field, value, ...]` reply or `{ error }` for a failing key.
 */
const pipelineMock = { hgetall: jest.fn(), exec: jest.fn() };
const readRedisMock = { pipeline: jest.fn() };
jest.mock("../redis", () => ({ getPoolsReadRedis: () => readRedisMock, getRedis: jest.fn() }));

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

const NOW = 1_790_700_000_000;
const WETH_TEL = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const EUSD_TEL = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";

const live = {
  status: "LIVE",
  apr: 66.9,
  aprBreakdown: [{ campaignId: "0xc1", apr: 66.9, distributionType: "DUTCH_AUCTION" }],
  dailyRewards: 168.4,
  subscribedTvlUSD: 91_840,
  campaignStart: NOW - 86_400_000,
  campaignEnd: NOW + 86_400_000,
};

const pool = (id: string) => ({ id, pool: { id }, poolSnapshots: [], metrics: { tvlUSD: 1 } });
const hourly = (fetchedAt = NOW) => ({ fetchedAt, indexedAt: null, hasIndexingErrors: false, data: [pool(WETH_TEL), pool(EUSD_TEL)] });
const rewardsHash = (fetchedAt = NOW) => ({ fetchedAt, indexedAt: null, hasIndexingErrors: false, data: [{ id: WETH_TEL, rewards: live }] });

// Polygon is served from the RPC pipeline's v3 key, which carries the metrics the rewards sit beside.
const POLYGON_HOURLY = "active-uniswap-polygon-grouped:v3";
const POLYGON_REWARDS = "merkl-rewards:polygon:v1";

const rewardsOf = (body: Awaited<ReturnType<typeof readAllGrouped>>) =>
  Object.fromEntries((body.groups["uniswap-polygon"]?.data ?? []).map(p => [p.id, (p as { rewards?: unknown }).rewards]));

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("rewards on the /api/pools read", () => {
  it("reads the rewards key in the same pipeline and attaches rewards to each pool, null where none matched", async () => {
    kvWith({ [POLYGON_HOURLY]: hourly(), [POLYGON_REWARDS]: rewardsHash(NOW - 60_000) });

    const body = await readAllGrouped(["uniswap-polygon"]);

    expect(readRedisMock.pipeline).toHaveBeenCalledTimes(1);
    expect(pipelineMock.hgetall.mock.calls.map(([key]) => key)).toEqual([
      "config:grouped-source",
      "active-uniswap-polygon-grouped:hourly:v2",
      "active-uniswap-polygon-grouped:daily:v2",
      POLYGON_HOURLY,
      POLYGON_REWARDS,
    ]);
    expect(rewardsOf(body)).toEqual({ [WETH_TEL]: { ...live, fetchedAt: NOW - 60_000 }, [EUSD_TEL]: null });
  });

  it("keeps each chain's rewards on its own group", async () => {
    kvWith({
      [POLYGON_HOURLY]: hourly(),
      "active-uniswap-ethereum-grouped:v3": hourly(),
      [POLYGON_REWARDS]: rewardsHash(),
      "merkl-rewards:ethereum:v1": { fetchedAt: NOW, data: [] },
    });

    const body = await readAllGrouped(["uniswap-ethereum", "uniswap-polygon"]);

    expect(rewardsOf(body)[WETH_TEL]).toMatchObject({ status: "LIVE" });
    expect(body.groups["uniswap-ethereum"]?.data.map(p => (p as { rewards?: unknown }).rewards)).toEqual([null, null]);
  });

  it("attaches rewards to the active and the archived pools of a group served from both sources", async () => {
    const ETH_TEL = "0x272e0968e2fb347236c6060cc9395f13591968f3f83056c600c755066dd214a6";
    const ARCHIVED = "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b";
    kvWith({
      "active-uniswap-base-grouped:v3": { ...hourly(), data: [pool(ETH_TEL), pool(EUSD_TEL)] },
      "active-uniswap-base-grouped:hourly:v2": { ...hourly(), data: [pool(ARCHIVED)] },
      "merkl-rewards:base:v1": {
        ...rewardsHash(),
        data: [
          { id: ETH_TEL, rewards: live },
          { id: ARCHIVED, rewards: { ...live, apr: 12 } },
        ],
      },
    });

    const body = await readAllGrouped(["uniswap-base"]);

    const rewards = Object.fromEntries((body.groups["uniswap-base"]?.data ?? []).map(p => [p.id, (p as { rewards?: unknown }).rewards]));
    expect(rewards).toEqual({
      [ETH_TEL]: { ...live, fetchedAt: NOW },
      [EUSD_TEL]: null,
      [ARCHIVED]: { ...live, apr: 12, fetchedAt: NOW },
    });
  });

  it("leaves rewards null and the pool data loaded when the rewards read fails", async () => {
    kvWith({ [POLYGON_HOURLY]: hourly(), [POLYGON_REWARDS]: rewardsHash() }, [POLYGON_REWARDS]);

    const body = await readAllGrouped(["uniswap-polygon"]);

    expect(body.failed).toEqual({});
    expect(body.groups["uniswap-polygon"]?.data[0]).toMatchObject({ metrics: { tvlUSD: 1 }, rewards: null });
    expect(rewardsOf(body)).toEqual({ [WETH_TEL]: null, [EUSD_TEL]: null });
    expect(JSON.stringify(body)).not.toContain("ERR");
    expect(console.error).toHaveBeenCalledWith(`Rewards read failed for ${POLYGON_REWARDS}`, expect.stringContaining("ERR"));
  });

  it("serves rewards at their age limit and nulls them past it", async () => {
    kvWith({ [POLYGON_HOURLY]: hourly(), [POLYGON_REWARDS]: rewardsHash(NOW - REWARDS_MAX_AGE_MS) });
    expect(rewardsOf(await readAllGrouped(["uniswap-polygon"]))[WETH_TEL]).toMatchObject({ status: "LIVE" });

    kvWith({ [POLYGON_HOURLY]: hourly(), [POLYGON_REWARDS]: rewardsHash(NOW - REWARDS_MAX_AGE_MS - 1) });
    const body = await readAllGrouped(["uniswap-polygon"]);
    expect(rewardsOf(body)[WETH_TEL]).toBeNull();
    expect(body.failed).toEqual({});
  });

  it("does not attach rewards to groups that failed or to other protocols", async () => {
    kvWith({ "active-quickswap-grouped:v2": { fetchedAt: NOW, data: [pool("0xq")] }, [POLYGON_REWARDS]: rewardsHash() }, [POLYGON_HOURLY]);

    const body = await readAllGrouped(["uniswap-polygon", "quickswap"]);

    expect(body.failed).toEqual({ "uniswap-polygon": "error" });
    expect(body.groups.quickswap?.data[0]).not.toHaveProperty("rewards");
  });
});

describe("/api/pools cache headers with rewards", () => {
  const SHARED = "public, s-maxage=30, stale-while-revalidate=300";

  it.each([
    ["present", {}, []],
    ["missing", { [POLYGON_REWARDS]: undefined }, []],
    ["stale", { [POLYGON_REWARDS]: rewardsHash(NOW - REWARDS_MAX_AGE_MS - 1) }, []],
    ["failing", {}, [POLYGON_REWARDS]],
  ])("keep the shared cache header when the rewards key is %s", async (_state, overrides, failing) => {
    const hashes: Record<string, Record<string, unknown>> = { [POLYGON_HOURLY]: hourly(), [POLYGON_REWARDS]: rewardsHash() };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete hashes[key];
      else hashes[key] = value;
    }
    kvWith(hashes, failing as string[]);

    const res = await GET(new Request("https://telx.example/api/pools"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(SHARED);
    const body = await res.json();
    expect(body.failed["uniswap-polygon"]).toBeUndefined();
  });
});
