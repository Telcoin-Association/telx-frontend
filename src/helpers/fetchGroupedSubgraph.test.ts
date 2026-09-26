import { fetchGroupedSubgraph } from "./fetchGroupedSubgraph";
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
