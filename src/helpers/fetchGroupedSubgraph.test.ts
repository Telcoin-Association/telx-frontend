import { GroupUnavailableError, LEGACY_FALLBACK_MAX_AGE_MS, fetchGroupedSubgraphs } from "./fetchGroupedSubgraph";
import type { GroupedSubgraphData } from "./fetchGroupedSubgraph";
import type { SubgraphGroup } from "@/types/PoolMetrics";
import { combineSubgraphMeta, subgraphGroupOf } from "./prefetchGroupedSubgraph";
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
    expect(res.balancer).toBeInstanceOf(GroupUnavailableError);
    expect(res["uniswap-base"]).not.toBeInstanceOf(GroupUnavailableError);
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

/** A fresh copy of the prefetch module, so its cache and last loaded data start empty in each test. */
async function freshPrefetch() {
  let mod!: typeof import("./prefetchGroupedSubgraph");
  await jest.isolateModulesAsync(async () => {
    mod = await import("./prefetchGroupedSubgraph");
  });
  return mod.prefetchGroupedSubgraph;
}

describe("prefetchGroupedSubgraph", () => {
  let prefetchGroupedSubgraph: Awaited<ReturnType<typeof freshPrefetch>>;

  beforeEach(async () => {
    prefetchGroupedSubgraph = await freshPrefetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

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

describe("prefetchGroupedSubgraph failures and caching", () => {
  let prefetchGroupedSubgraph: Awaited<ReturnType<typeof freshPrefetch>>;

  const contracts = [
    { protocol: "uniswap", blockchain: "base", pool: "0xB", fetchSubgraph: true, active: true },
    { protocol: "balancer", blockchain: "polygon", pool: "0xQ", subgraphId: "0xq", fetchSubgraph: true, active: true },
  ] as miningContract[];
  const group = (fetchedAt: number, id: string) => ({ fetchedAt, indexedAt: null, hasIndexingErrors: false, data: [pool(id)] });
  const bothLoaded = (fetchedAt: number) =>
    respond({ groups: { "uniswap-base": group(fetchedAt, "0xb"), balancer: group(fetchedAt, "0xq") }, failed: {} });

  beforeEach(async () => {
    prefetchGroupedSubgraph = await freshPrefetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    ["the request fails", () => respond({ groups: {}, failed: {} }, 503)],
    ["the request throws", () => Promise.reject(new TypeError("Failed to fetch"))],
    [
      "the route marks every requested group failed",
      () => respond({ groups: { quickswap: group(1, "0x1") }, failed: { "uniswap-base": "error", balancer: "unavailable" } }),
    ],
  ])("rejects when every requested group failed because %s, and caches nothing", async (_, failure) => {
    fetchMock.mockImplementationOnce(failure).mockImplementationOnce(() => bothLoaded(5000));

    await expect(prefetchGroupedSubgraph(contracts)).rejects.toThrow("Pool data could not be loaded (uniswap-base, balancer)");

    const res = await prefetchGroupedSubgraph(contracts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(res.uniswapById)).toEqual(["base:0xb"]);
    expect(Object.keys(res.balancerById)).toEqual(["0xq"]);
  });

  it("caches a complete load for the TTL", async () => {
    fetchMock.mockImplementation(() => bothLoaded(5000));

    const first = await prefetchGroupedSubgraph(contracts);
    const second = await prefetchGroupedSubgraph(contracts);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("does not cache a load with a failed group, so the next call asks for it again", async () => {
    fetchMock
      .mockImplementationOnce(() => respond({ groups: { "uniswap-base": group(5000, "0xb") }, failed: { balancer: "error" } }))
      .mockImplementationOnce(() => bothLoaded(6000));

    const partial = await prefetchGroupedSubgraph(contracts);
    expect(partial.balancerById).toEqual({});
    expect(Object.keys(partial.meta.sources)).toEqual(["uniswap-base"]);

    const retried = await prefetchGroupedSubgraph(contracts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(retried.balancerById)).toEqual(["0xq"]);
    expect(retried.meta.sources.balancer).toEqual({ fetchedAt: 6000, indexedAt: null, hasIndexingErrors: false });
  });

  it("keeps a group's last loaded data, with its own freshness, when a refetch fails to read it", async () => {
    fetchMock
      .mockImplementationOnce(() => bothLoaded(5000))
      .mockImplementationOnce(() => respond({ groups: { "uniswap-base": group(7000, "0xb") }, failed: { balancer: "error" } }))
      .mockImplementationOnce(() => bothLoaded(8000));

    const first = await prefetchGroupedSubgraph(contracts, 0);
    const refetch = await prefetchGroupedSubgraph(contracts, 0);

    expect(refetch.balancerById).toEqual(first.balancerById);
    expect(refetch.meta.sources).toEqual({
      "uniswap-base": { fetchedAt: 7000, indexedAt: null, hasIndexingErrors: false },
      balancer: { fetchedAt: 5000, indexedAt: null, hasIndexingErrors: false },
    });
    expect(refetch.meta.fetchedAt).toBe(5000);

    // Not cached: the next call asks again, even with the default TTL.
    await prefetchGroupedSubgraph(contracts);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("drops a group's last loaded data when the server reports it unavailable", async () => {
    fetchMock
      .mockImplementationOnce(() => bothLoaded(5000))
      .mockImplementationOnce(() => respond({ groups: { "uniswap-base": group(7000, "0xb") }, failed: { balancer: "unavailable" } }))
      .mockImplementationOnce(() => respond({ groups: { "uniswap-base": group(7000, "0xb") }, failed: { balancer: "error" } }));

    await prefetchGroupedSubgraph(contracts, 0);
    const unavailable = await prefetchGroupedSubgraph(contracts, 0);
    const errored = await prefetchGroupedSubgraph(contracts, 0);

    expect(unavailable.balancerById).toEqual({});
    expect(unavailable.meta.sources.balancer).toBeUndefined();
    expect(errored.balancerById).toEqual({});
  });

  it("rejects a refetch in which every group failed, even with data loaded before", async () => {
    fetchMock.mockImplementationOnce(() => bothLoaded(5000)).mockImplementationOnce(() => respond({ groups: {}, failed: {} }, 503));

    await prefetchGroupedSubgraph(contracts, 0);

    await expect(prefetchGroupedSubgraph(contracts, 0)).rejects.toThrow("Pool data could not be loaded");
  });

  it("shares one request between concurrent calls and rejects both when it fails", async () => {
    fetchMock.mockImplementationOnce(() => respond({ groups: {}, failed: {} }, 503));

    const calls = [prefetchGroupedSubgraph(contracts), prefetchGroupedSubgraph(contracts)];

    await expect(calls[0]).rejects.toThrow("Pool data could not be loaded");
    await expect(calls[1]).rejects.toThrow("Pool data could not be loaded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
