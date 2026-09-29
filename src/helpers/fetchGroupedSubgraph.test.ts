import { LEGACY_FALLBACK_MAX_AGE_MS, fetchGroupedSubgraphs } from "./fetchGroupedSubgraph";
import type { GroupedSubgraphData } from "./fetchGroupedSubgraph";
import type { SubgraphGroup } from "@/types/PoolMetrics";
import { combineSubgraphMeta, prefetchGroupedSubgraph, subgraphGroupOf } from "./prefetchGroupedSubgraph";
import { miningContract } from "./normalizeMiningContracts";

const pool = (id: string) => ({ id, pool: { id }, poolSnapshots: [], threeMonthLiquidityData: [] });

const respond = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

const fetchMock = jest.fn();

/** Serves `body` as one group of an /api/pools response. */
const respondGroup = (group: SubgraphGroup, body: unknown) => respond({ groups: { [group]: body }, failed: {} });

/** Fetches one group through fetchGroupedSubgraphs and throws its error, as a caller would see it. */
async function fetchGroup(group: SubgraphGroup): Promise<GroupedSubgraphData> {
  const result = (await fetchGroupedSubgraphs([group]))[group];
  if (!result) throw new Error(`no result for ${group}`);
  if (result instanceof Error) throw result;
  return result;
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});

afterEach(() => jest.restoreAllMocks());

describe("fetchGroupedSubgraphs", () => {
  it("reads the v2 object and its freshness", async () => {
    fetchMock.mockReturnValue(
      respondGroup("uniswap-base", { fetchedAt: 2000, indexedAt: 1000, hasIndexingErrors: false, parts: {}, data: [pool("0xAbC")] })
    );

    const res = await fetchGroup("uniswap-base");

    expect(fetchMock).toHaveBeenCalledWith("/api/pools", { method: "GET" });
    expect(res.list).toHaveLength(1);
    expect(res.byId["0xabc"].id).toBe("0xAbC");
    expect(res.meta).toEqual({ fetchedAt: 2000, indexedAt: 1000, hasIndexingErrors: false });
  });

  it("marks metrics as null on a v2 payload whose pool has none", async () => {
    fetchMock.mockReturnValueOnce(
      respondGroup("uniswap-base", { fetchedAt: 2000, indexedAt: 1000, hasIndexingErrors: false, parts: { legacy: false }, data: [pool("0xa")] })
    );
    expect((await fetchGroup("uniswap-base")).byId["0xa"].metrics).toBeNull();
  });

  describe("legacy-filled payloads", () => {
    const now = 1_758_900_000_000;
    const legacyBody = (fetchedAt: number | null) => ({
      fetchedAt,
      indexedAt: null,
      hasIndexingErrors: null,
      parts: { hourly: null, daily: null, legacy: true },
      data: [pool("0xa"), { ...pool("0xb"), metrics: null }],
    });

    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(now));

    it("leaves metrics undefined for local math while the legacy rows are recent", async () => {
      fetchMock.mockReturnValueOnce(respondGroup("uniswap-polygon", legacyBody(now - LEGACY_FALLBACK_MAX_AGE_MS + 1)));

      const res = await fetchGroup("uniswap-polygon");

      expect(res.byId["0xa"].metrics).toBeUndefined();
      expect(res.byId["0xb"].metrics).toBeNull();
    });

    it("marks metrics as null once the legacy rows are too old to describe the last 24h", async () => {
      fetchMock.mockReturnValueOnce(respondGroup("uniswap-polygon", legacyBody(now - LEGACY_FALLBACK_MAX_AGE_MS)));

      expect((await fetchGroup("uniswap-polygon")).byId["0xa"].metrics).toBeNull();
    });

    it("marks metrics as null when the legacy payload has no fetchedAt", async () => {
      fetchMock.mockReturnValueOnce(respondGroup("quickswap", legacyBody(null)));

      expect((await fetchGroup("quickswap")).byId["0xa"].metrics).toBeNull();
    });

    it("keeps metrics a borrowed daily part leaves in place", async () => {
      const metrics = { tvlUSD: 1, volume24h: 0, fees24h: 0 };
      fetchMock.mockReturnValueOnce(respondGroup("uniswap-polygon", { ...legacyBody(now - 2 * LEGACY_FALLBACK_MAX_AGE_MS), data: [{ ...pool("0xa"), metrics }] }));

      expect((await fetchGroup("uniswap-polygon")).byId["0xa"].metrics).toEqual(metrics);
    });
  });

  it("leaves metrics undefined on a pre-v2 object without parts", async () => {
    fetchMock.mockReturnValueOnce(respondGroup("uniswap-base", { fetchedAt: 2000, data: [pool("0xa")] }));

    expect((await fetchGroup("uniswap-base")).byId["0xa"].metrics).toBeUndefined();
  });

  it("accepts the legacy array with unknown freshness", async () => {
    fetchMock.mockReturnValue(respondGroup("quickswap", [pool("0x1")]));

    const res = await fetchGroup("quickswap");

    expect(Object.keys(res.byId)).toEqual(["0x1"]);
    expect(res.meta).toEqual({ fetchedAt: null, indexedAt: null, hasIndexingErrors: null });
  });

  it("fails every requested group when the request fails", async () => {
    fetchMock.mockReturnValue(respond({ error: "nope" }, 502));

    const res = await fetchGroupedSubgraphs(["balancer", "quickswap"]);

    expect(res.balancer).toBeInstanceOf(Error);
    expect(res.quickswap).toBeInstanceOf(Error);
    expect((res.balancer as Error).message).toContain("502");
  });

  it("fails a group the route marked as failed or left out, and keeps the others", async () => {
    fetchMock.mockReturnValue(
      respond({ groups: { quickswap: { fetchedAt: 1, data: [pool("0x1")] } }, failed: { balancer: "unavailable" } })
    );

    const res = await fetchGroupedSubgraphs(["balancer", "quickswap", "uniswap-base"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((res.balancer as Error).message).toContain("balancer grouped data (unavailable)");
    expect((res["uniswap-base"] as Error).message).toContain("uniswap-base grouped data (missing)");
    expect(Object.keys((res.quickswap as GroupedSubgraphData).byId)).toEqual(["0x1"]);
  });

  it("makes no request when no group is wanted", async () => {
    await expect(fetchGroupedSubgraphs([])).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("combineSubgraphMeta", () => {
  it("takes the oldest timestamps and flags any indexing error", () => {
    const sources = {
      balancer: { fetchedAt: 3000, indexedAt: null, hasIndexingErrors: false },
      "uniswap-base": { fetchedAt: 2000, indexedAt: 1500, hasIndexingErrors: true },
      quickswap: { fetchedAt: null, indexedAt: null, hasIndexingErrors: null },
    };

    expect(combineSubgraphMeta(sources)).toEqual({ fetchedAt: 2000, indexedAt: 1500, hasIndexingErrors: true, sources });
  });

  it("is all null with no sources", () => {
    expect(combineSubgraphMeta({})).toEqual({ fetchedAt: null, indexedAt: null, hasIndexingErrors: null, sources: {} });
  });
});

describe("prefetchGroupedSubgraph", () => {
  it("makes one request, keeps only wanted groups and lists a failed active group apart from the sources", async () => {
    const loaded = { fetchedAt: 5000, indexedAt: 4000, hasIndexingErrors: false, data: [pool("0xp")] };
    fetchMock.mockReturnValue(
      respond({ groups: { "uniswap-polygon": loaded, "uniswap-base": loaded, quickswap: loaded }, failed: { balancer: "error" } })
    );
    const contracts = [
      { protocol: "uniswap", blockchain: "polygon", pool: "0xP", fetchSubgraph: true, active: true },
      { protocol: "uniswap", blockchain: "base", pool: "0xB", fetchSubgraph: false, active: true },
      { protocol: "balancer", blockchain: "polygon", pool: "0xQ", subgraphId: "0xq", fetchSubgraph: true, active: true },
    ] as miningContract[];
    jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await prefetchGroupedSubgraph(contracts);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/pools"]);
    expect(Object.keys(res.uniswapById)).toEqual(["polygon:0xp"]);
    expect(res.balancerById).toEqual({});
    expect(res.meta).toEqual({
      fetchedAt: 5000,
      indexedAt: 4000,
      hasIndexingErrors: false,
      sources: { "uniswap-polygon": { fetchedAt: 5000, indexedAt: 4000, hasIndexingErrors: false } },
      failed: ["balancer"],
    });
  });

  it("does not list a failed group that serves only archived pools", async () => {
    const loaded = { fetchedAt: 7000, indexedAt: 7000, hasIndexingErrors: false, data: [pool("0xa")] };
    fetchMock.mockReturnValue(respond({ groups: { "uniswap-ethereum": loaded }, failed: { quickswap: "unavailable" } }));
    const contracts = [
      { protocol: "uniswap", blockchain: "ethereum", pool: "0xA", fetchSubgraph: true, active: true },
      { protocol: "quickswap", blockchain: "polygon", pool: "0xQ", fetchSubgraph: true, active: false },
    ] as miningContract[];
    jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await prefetchGroupedSubgraph(contracts);

    expect(res.quickswapById).toEqual({});
    expect(res.meta).toEqual({
      fetchedAt: 7000,
      indexedAt: 7000,
      hasIndexingErrors: false,
      sources: { "uniswap-ethereum": { fetchedAt: 7000, indexedAt: 7000, hasIndexingErrors: false } },
    });
    expect(res.meta).not.toHaveProperty("failed");
  });

  it("fetches a group for its archived pools but keeps it out of the freshness", async () => {
    const body = (fetchedAt: number) => ({ fetchedAt, indexedAt: fetchedAt, hasIndexingErrors: false, data: [pool("0xp")] });
    fetchMock.mockReturnValue(
      respond({ groups: { "uniswap-base": body(9000), "uniswap-polygon": body(2000), quickswap: body(1000) }, failed: {} })
    );
    const contracts = [
      { protocol: "uniswap", blockchain: "base", pool: "0xP", fetchSubgraph: true, active: true },
      { protocol: "uniswap", blockchain: "polygon", pool: "0xP", fetchSubgraph: true, active: false },
      { protocol: "quickswap", blockchain: "polygon", pool: "0xP", fetchSubgraph: true, active: false },
    ] as miningContract[];

    const res = await prefetchGroupedSubgraph(contracts);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/pools"]);
    expect(Object.keys(res.quickswapById)).toEqual(["0xp"]);
    expect(Object.keys(res.uniswapById).sort()).toEqual(["base:0xp", "polygon:0xp"]);
    expect(res.meta).toEqual({
      fetchedAt: 9000,
      indexedAt: 9000,
      hasIndexingErrors: false,
      sources: { "uniswap-base": { fetchedAt: 9000, indexedAt: 9000, hasIndexingErrors: false } },
    });
  });
});

describe("subgraphGroupOf", () => {
  it("maps a pool to its group", () => {
    expect(subgraphGroupOf({ protocol: "uniswap", blockchain: "base" })).toBe("uniswap-base");
    expect(subgraphGroupOf({ protocol: "uniswap", blockchain: "polygon" })).toBe("uniswap-polygon");
    expect(subgraphGroupOf({ protocol: "uniswap", blockchain: "ethereum" })).toBe("uniswap-ethereum");
    expect(subgraphGroupOf({ protocol: "balancer", blockchain: "polygon" })).toBe("balancer");
    expect(subgraphGroupOf({ protocol: "quickswap", blockchain: "polygon" })).toBe("quickswap");
    expect(subgraphGroupOf({ protocol: "uniswap", blockchain: "arbitrum" })).toBeNull();
    expect(subgraphGroupOf({ protocol: "dfx", blockchain: "polygon" })).toBeNull();
  });
});
