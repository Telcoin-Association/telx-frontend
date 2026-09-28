import { LEGACY_FALLBACK_MAX_AGE_MS, fetchGroupedSubgraph } from "./fetchGroupedSubgraph";
import { combineSubgraphMeta, prefetchGroupedSubgraph } from "./prefetchGroupedSubgraph";
import { miningContract } from "./normalizeMiningContracts";

const pool = (id: string) => ({ id, pool: { id }, poolSnapshots: [], threeMonthLiquidityData: [] });

const respond = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});

afterEach(() => jest.restoreAllMocks());

describe("fetchGroupedSubgraph", () => {
  it("reads the v2 object and its freshness", async () => {
    fetchMock.mockReturnValue(
      respond({ fetchedAt: 2000, indexedAt: 1000, hasIndexingErrors: false, parts: {}, data: [pool("0xAbC")] })
    );

    const res = await fetchGroupedSubgraph("uniswap-base");

    expect(fetchMock).toHaveBeenCalledWith("/api/backend/subgraphs/uniswap-base-grouped", { method: "GET" });
    expect(res.list).toHaveLength(1);
    expect(res.byId["0xabc"].id).toBe("0xAbC");
    expect(res.meta).toEqual({ fetchedAt: 2000, indexedAt: 1000, hasIndexingErrors: false });
  });

  it("marks metrics as null on a v2 payload whose pool has none", async () => {
    fetchMock.mockReturnValueOnce(
      respond({ fetchedAt: 2000, indexedAt: 1000, hasIndexingErrors: false, parts: { legacy: false }, data: [pool("0xa")] })
    );
    expect((await fetchGroupedSubgraph("uniswap-base")).byId["0xa"].metrics).toBeNull();
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
      fetchMock.mockReturnValueOnce(respond(legacyBody(now - LEGACY_FALLBACK_MAX_AGE_MS + 1)));

      const res = await fetchGroupedSubgraph("uniswap-polygon");

      expect(res.byId["0xa"].metrics).toBeUndefined();
      expect(res.byId["0xb"].metrics).toBeNull();
    });

    it("marks metrics as null once the legacy rows are too old to describe the last 24h", async () => {
      fetchMock.mockReturnValueOnce(respond(legacyBody(now - LEGACY_FALLBACK_MAX_AGE_MS)));

      expect((await fetchGroupedSubgraph("uniswap-polygon")).byId["0xa"].metrics).toBeNull();
    });

    it("marks metrics as null when the legacy payload has no fetchedAt", async () => {
      fetchMock.mockReturnValueOnce(respond(legacyBody(null)));

      expect((await fetchGroupedSubgraph("quickswap")).byId["0xa"].metrics).toBeNull();
    });

    it("keeps metrics a borrowed daily part leaves in place", async () => {
      const metrics = { tvlUSD: 1, volume24h: 0, fees24h: 0 };
      fetchMock.mockReturnValueOnce(respond({ ...legacyBody(now - 2 * LEGACY_FALLBACK_MAX_AGE_MS), data: [{ ...pool("0xa"), metrics }] }));

      expect((await fetchGroupedSubgraph("uniswap-polygon")).byId["0xa"].metrics).toEqual(metrics);
    });
  });

  it("leaves metrics undefined on a pre-v2 object without parts", async () => {
    fetchMock.mockReturnValueOnce(respond({ fetchedAt: 2000, data: [pool("0xa")] }));

    expect((await fetchGroupedSubgraph("uniswap-base")).byId["0xa"].metrics).toBeUndefined();
  });

  it("accepts the legacy array with unknown freshness", async () => {
    fetchMock.mockReturnValue(respond([pool("0x1")]));

    const res = await fetchGroupedSubgraph("quickswap");

    expect(Object.keys(res.byId)).toEqual(["0x1"]);
    expect(res.meta).toEqual({ fetchedAt: null, indexedAt: null, hasIndexingErrors: null });
  });

  it("throws on a failed response", async () => {
    fetchMock.mockReturnValue(respond({ error: "nope" }, 502));

    await expect(fetchGroupedSubgraph("balancer")).rejects.toThrow("balancer");
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
  it("fetches only wanted groups and leaves a failed group out of meta", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("balancer")
        ? respond({ error: "down" }, 500)
        : respond({ fetchedAt: 5000, indexedAt: 4000, hasIndexingErrors: false, data: [pool("0xp")] })
    );
    const contracts = [
      { protocol: "uniswap", blockchain: "polygon", pool: "0xP", fetchSubgraph: true },
      { protocol: "uniswap", blockchain: "base", pool: "0xB", fetchSubgraph: false },
      { protocol: "balancer", blockchain: "polygon", pool: "0xQ", subgraphId: "0xq", fetchSubgraph: true },
    ] as miningContract[];
    jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await prefetchGroupedSubgraph(contracts);

    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      "/api/backend/subgraphs/balancer-grouped",
      "/api/backend/subgraphs/uniswap-polygon-grouped",
    ]);
    expect(Object.keys(res.uniswapById)).toEqual(["polygon:0xp"]);
    expect(res.balancerById).toEqual({});
    expect(res.meta).toEqual({
      fetchedAt: 5000,
      indexedAt: 4000,
      hasIndexingErrors: false,
      sources: { "uniswap-polygon": { fetchedAt: 5000, indexedAt: 4000, hasIndexingErrors: false } },
    });
  });
});
