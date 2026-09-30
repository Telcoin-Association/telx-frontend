import { GroupUnavailableError, LEGACY_FALLBACK_MAX_AGE_MS, fetchPoolGroups } from "./fetchPoolData";
import type { PoolGroupData } from "./fetchPoolData";
import type { PoolGroup } from "@/types/PoolMetrics";
import { combinePoolDataMeta, poolGroupOf } from "./prefetchPoolData";
import { miningContract } from "./normalizeMiningContracts";

const pool = (id: string) => ({ id, pool: { id }, poolSnapshots: [], threeMonthLiquidityData: [] });

const respond = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

const fetchMock = jest.fn();

/** Serves `body` as one group of an /api/pools response. */
const respondGroup = (group: PoolGroup, body: unknown) => respond({ groups: { [group]: body }, failed: {} });

/** Fetches one group through fetchPoolGroups and throws its error, as a caller would see it. */
async function fetchGroup(group: PoolGroup): Promise<PoolGroupData> {
  const result = (await fetchPoolGroups([group]))[group];
  if (!result) throw new Error(`no result for ${group}`);
  if (result instanceof Error) throw result;
  return result;
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});

afterEach(() => jest.restoreAllMocks());

describe("fetchPoolGroups", () => {
  it("reads the grouped object and its freshness", async () => {
    fetchMock.mockReturnValue(
      respondGroup("uniswap-base", { fetchedAt: 2000, indexedAt: 1000, hasIndexingErrors: false, parts: {}, data: [pool("0xAbC")] })
    );

    const res = await fetchGroup("uniswap-base");

    expect(fetchMock).toHaveBeenCalledWith("/api/pools", { method: "GET" });
    expect(res.list).toHaveLength(1);
    expect(res.byId["0xabc"].id).toBe("0xAbC");
    expect(res.meta).toEqual({ fetchedAt: 2000, indexedAt: 1000, hasIndexingErrors: false });
  });

  it("marks metrics as null on a current payload whose pool has none", async () => {
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
      fetchMock.mockReturnValueOnce(respondGroup("uniswap-ethereum", legacyBody(null)));

      expect((await fetchGroup("uniswap-ethereum")).byId["0xa"].metrics).toBeNull();
    });

    it("keeps metrics a borrowed daily part leaves in place", async () => {
      const metrics = { tvlUSD: 1, volume24h: 0, fees24h: 0 };
      fetchMock.mockReturnValueOnce(respondGroup("uniswap-polygon", { ...legacyBody(now - 2 * LEGACY_FALLBACK_MAX_AGE_MS), data: [{ ...pool("0xa"), metrics }] }));

      expect((await fetchGroup("uniswap-polygon")).byId["0xa"].metrics).toEqual(metrics);
    });
  });

  it("leaves metrics undefined on an older object without parts", async () => {
    fetchMock.mockReturnValueOnce(respondGroup("uniswap-base", { fetchedAt: 2000, data: [pool("0xa")] }));

    expect((await fetchGroup("uniswap-base")).byId["0xa"].metrics).toBeUndefined();
  });

  it("accepts the legacy array with unknown freshness", async () => {
    fetchMock.mockReturnValue(respondGroup("uniswap-ethereum", [pool("0x1")]));

    const res = await fetchGroup("uniswap-ethereum");

    expect(Object.keys(res.byId)).toEqual(["0x1"]);
    expect(res.meta).toEqual({ fetchedAt: null, indexedAt: null, hasIndexingErrors: null });
  });

  it("fails every requested group when the request fails", async () => {
    fetchMock.mockReturnValue(respond({ error: "nope" }, 502));

    const res = await fetchPoolGroups(["uniswap-ethereum", "uniswap-polygon"]);

    expect(res["uniswap-ethereum"]).toBeInstanceOf(Error);
    expect(res["uniswap-polygon"]).toBeInstanceOf(Error);
    expect((res["uniswap-ethereum"] as Error).message).toContain("502");
  });

  it("fails a group the route marked as failed or left out, and keeps the others", async () => {
    fetchMock.mockReturnValue(
      respond({ groups: { "uniswap-polygon": { fetchedAt: 1, data: [pool("0x1")] } }, failed: { "uniswap-ethereum": "unavailable" } })
    );

    const res = await fetchPoolGroups(["uniswap-ethereum", "uniswap-polygon", "uniswap-base"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((res["uniswap-ethereum"] as Error).message).toContain("uniswap-ethereum grouped data (unavailable)");
    expect(res["uniswap-ethereum"]).toBeInstanceOf(GroupUnavailableError);
    expect(res["uniswap-base"]).not.toBeInstanceOf(GroupUnavailableError);
    expect((res["uniswap-base"] as Error).message).toContain("uniswap-base grouped data (missing)");
    expect(Object.keys((res["uniswap-polygon"] as PoolGroupData).byId)).toEqual(["0x1"]);
  });

  it("makes no request when no group is wanted", async () => {
    await expect(fetchPoolGroups([])).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("combinePoolDataMeta", () => {
  it("takes the oldest timestamps and flags any indexing error", () => {
    const sources = {
      "uniswap-polygon": { fetchedAt: 3000, indexedAt: null, hasIndexingErrors: false },
      "uniswap-base": { fetchedAt: 2000, indexedAt: 1500, hasIndexingErrors: true },
      "uniswap-ethereum": { fetchedAt: null, indexedAt: null, hasIndexingErrors: null },
    };

    expect(combinePoolDataMeta(sources)).toEqual({ fetchedAt: 2000, indexedAt: 1500, hasIndexingErrors: true, sources });
  });

  it("is all null with no sources", () => {
    expect(combinePoolDataMeta({})).toEqual({ fetchedAt: null, indexedAt: null, hasIndexingErrors: null, sources: {} });
  });
});

/** A fresh copy of the prefetch module, so its cache and last loaded data start empty in each test. */
async function freshPrefetch() {
  let mod!: typeof import("./prefetchPoolData");
  await jest.isolateModulesAsync(async () => {
    mod = await import("./prefetchPoolData");
  });
  return mod.prefetchPoolData;
}

describe("prefetchPoolData", () => {
  let prefetchPoolData: Awaited<ReturnType<typeof freshPrefetch>>;

  beforeEach(async () => {
    prefetchPoolData = await freshPrefetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it("makes one request, keeps only the wanted groups and lists a failed active group apart from the sources", async () => {
    const loaded = { fetchedAt: 5000, indexedAt: 4000, hasIndexingErrors: false, data: [pool("0xp")] };
    fetchMock.mockReturnValue(respond({ groups: { "uniswap-polygon": loaded, "uniswap-base": loaded }, failed: { "uniswap-ethereum": "error" } }));
    const contracts = [
      { protocol: "uniswap", blockchain: "polygon", pool: "0xP", active: true },
      { protocol: "uniswap", blockchain: "ethereum", pool: "0xE", active: true },
      { protocol: "balancer", blockchain: "polygon", pool: "0xQ", subgraphId: "0xq", active: true },
    ] as miningContract[];

    const res = await prefetchPoolData(contracts);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/pools"]);
    expect(Object.keys(res.uniswapById)).toEqual(["polygon:0xp"]);
    expect(res.meta).toEqual({
      fetchedAt: 5000,
      indexedAt: 4000,
      hasIndexingErrors: false,
      sources: { "uniswap-polygon": { fetchedAt: 5000, indexedAt: 4000, hasIndexingErrors: false } },
      failed: ["uniswap-ethereum"],
    });
  });

  it("requests no group for pools of other protocols", async () => {
    const contracts = [
      { protocol: "balancer", blockchain: "polygon", pool: "0xQ", subgraphId: "0xq", active: false },
      { protocol: "quickswap", blockchain: "polygon", pool: "0xR", active: false },
    ] as miningContract[];

    const res = await prefetchPoolData(contracts);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.uniswapById).toEqual({});
  });

  it("does not list a failed chain that has only archived pools", async () => {
    const loaded = { fetchedAt: 7000, indexedAt: 7000, hasIndexingErrors: false, data: [pool("0xa")] };
    fetchMock.mockReturnValue(respond({ groups: { "uniswap-ethereum": loaded }, failed: { "uniswap-base": "unavailable" } }));
    const contracts = [
      { protocol: "uniswap", blockchain: "ethereum", pool: "0xA", active: true },
      { protocol: "uniswap", blockchain: "base", pool: "0xB", active: false },
    ] as miningContract[];

    const res = await prefetchPoolData(contracts);

    expect(res.meta).toEqual({
      fetchedAt: 7000,
      indexedAt: 7000,
      hasIndexingErrors: false,
      sources: { "uniswap-ethereum": { fetchedAt: 7000, indexedAt: 7000, hasIndexingErrors: false } },
    });
    expect(res.meta).not.toHaveProperty("failed");
  });

  it("fetches a chain with only archived pools but keeps it out of the freshness", async () => {
    const body = (fetchedAt: number) => ({ fetchedAt, indexedAt: fetchedAt, hasIndexingErrors: false, data: [pool("0xp")] });
    fetchMock.mockReturnValue(respond({ groups: { "uniswap-base": body(9000), "uniswap-polygon": body(2000) }, failed: {} }));
    const contracts = [
      { protocol: "uniswap", blockchain: "base", pool: "0xP", active: true },
      { protocol: "uniswap", blockchain: "polygon", pool: "0xP", active: false },
    ] as miningContract[];

    const res = await prefetchPoolData(contracts);

    expect(Object.keys(res.uniswapById).sort()).toEqual(["base:0xp", "polygon:0xp"]);
    expect(res.meta).toEqual({
      fetchedAt: 9000,
      indexedAt: 9000,
      hasIndexingErrors: false,
      sources: { "uniswap-base": { fetchedAt: 9000, indexedAt: 9000, hasIndexingErrors: false } },
    });
  });
});

describe("poolGroupOf", () => {
  it("maps a Uniswap pool to its chain's group, and every other pool to none", () => {
    expect(poolGroupOf({ protocol: "uniswap", blockchain: "base" })).toBe("uniswap-base");
    expect(poolGroupOf({ protocol: "uniswap", blockchain: "polygon" })).toBe("uniswap-polygon");
    expect(poolGroupOf({ protocol: "uniswap", blockchain: "ethereum" })).toBe("uniswap-ethereum");
    expect(poolGroupOf({ protocol: "balancer", blockchain: "polygon" })).toBeNull();
    expect(poolGroupOf({ protocol: "quickswap", blockchain: "polygon" })).toBeNull();
    expect(poolGroupOf({ protocol: "uniswap", blockchain: "arbitrum" })).toBeNull();
    expect(poolGroupOf({ protocol: "dfx", blockchain: "polygon" })).toBeNull();
  });
});

describe("prefetchPoolData failures and caching", () => {
  let prefetchPoolData: Awaited<ReturnType<typeof freshPrefetch>>;

  const contracts = [
    { protocol: "uniswap", blockchain: "base", pool: "0xB", active: true },
    { protocol: "uniswap", blockchain: "ethereum", pool: "0xQ", active: true },
  ] as miningContract[];
  const group = (fetchedAt: number, id: string) => ({ fetchedAt, indexedAt: null, hasIndexingErrors: false, data: [pool(id)] });
  const bothLoaded = (fetchedAt: number) =>
    respond({ groups: { "uniswap-base": group(fetchedAt, "0xb"), "uniswap-ethereum": group(fetchedAt, "0xq") }, failed: {} });

  beforeEach(async () => {
    prefetchPoolData = await freshPrefetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    ["the request fails", () => respond({ groups: {}, failed: {} }, 503)],
    ["the request throws", () => Promise.reject(new TypeError("Failed to fetch"))],
    [
      "the route marks every requested group failed",
      () => respond({ groups: { "uniswap-polygon": group(1, "0x1") }, failed: { "uniswap-base": "error", "uniswap-ethereum": "unavailable" } }),
    ],
  ])("rejects when every requested group failed because %s, and caches nothing", async (_, failure) => {
    fetchMock.mockImplementationOnce(failure).mockImplementationOnce(() => bothLoaded(5000));

    await expect(prefetchPoolData(contracts)).rejects.toThrow("Pool data could not be loaded (uniswap-base, uniswap-ethereum)");

    const res = await prefetchPoolData(contracts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(res.uniswapById)).toEqual(["base:0xb", "ethereum:0xq"]);
  });

  it("caches a complete load for the TTL", async () => {
    fetchMock.mockImplementation(() => bothLoaded(5000));

    const first = await prefetchPoolData(contracts);
    const second = await prefetchPoolData(contracts);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("does not cache a load with a failed group, so the next call asks for it again", async () => {
    fetchMock
      .mockImplementationOnce(() => respond({ groups: { "uniswap-base": group(5000, "0xb") }, failed: { "uniswap-ethereum": "error" } }))
      .mockImplementationOnce(() => bothLoaded(6000));

    const partial = await prefetchPoolData(contracts);
    expect(Object.keys(partial.uniswapById)).toEqual(["base:0xb"]);
    expect(Object.keys(partial.meta.sources)).toEqual(["uniswap-base"]);

    const retried = await prefetchPoolData(contracts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(retried.uniswapById)).toEqual(["base:0xb", "ethereum:0xq"]);
    expect(retried.meta.sources["uniswap-ethereum"]).toEqual({ fetchedAt: 6000, indexedAt: null, hasIndexingErrors: false });
  });

  it("keeps a group's last loaded data, with its own freshness, when a refetch fails to read it", async () => {
    fetchMock
      .mockImplementationOnce(() => bothLoaded(5000))
      .mockImplementationOnce(() => respond({ groups: { "uniswap-base": group(7000, "0xb") }, failed: { "uniswap-ethereum": "error" } }))
      .mockImplementationOnce(() => bothLoaded(8000));

    const first = await prefetchPoolData(contracts, 0);
    const refetch = await prefetchPoolData(contracts, 0);

    expect(refetch.uniswapById["ethereum:0xq"]).toEqual(first.uniswapById["ethereum:0xq"]);
    expect(refetch.meta.sources).toEqual({
      "uniswap-base": { fetchedAt: 7000, indexedAt: null, hasIndexingErrors: false },
      "uniswap-ethereum": { fetchedAt: 5000, indexedAt: null, hasIndexingErrors: false },
    });
    expect(refetch.meta.fetchedAt).toBe(5000);

    // Not cached: the next call asks again, even with the default TTL.
    await prefetchPoolData(contracts);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("drops a group's last loaded data when the server reports it unavailable", async () => {
    fetchMock
      .mockImplementationOnce(() => bothLoaded(5000))
      .mockImplementationOnce(() => respond({ groups: { "uniswap-base": group(7000, "0xb") }, failed: { "uniswap-ethereum": "unavailable" } }))
      .mockImplementationOnce(() => respond({ groups: { "uniswap-base": group(7000, "0xb") }, failed: { "uniswap-ethereum": "error" } }));

    await prefetchPoolData(contracts, 0);
    const unavailable = await prefetchPoolData(contracts, 0);
    const errored = await prefetchPoolData(contracts, 0);

    expect(unavailable.uniswapById["ethereum:0xq"]).toBeUndefined();
    expect(unavailable.meta.sources["uniswap-ethereum"]).toBeUndefined();
    expect(errored.uniswapById["ethereum:0xq"]).toBeUndefined();
  });

  it("rejects a refetch in which every group failed, even with data loaded before", async () => {
    fetchMock.mockImplementationOnce(() => bothLoaded(5000)).mockImplementationOnce(() => respond({ groups: {}, failed: {} }, 503));

    await prefetchPoolData(contracts, 0);

    await expect(prefetchPoolData(contracts, 0)).rejects.toThrow("Pool data could not be loaded");
  });

  it("shares one request between concurrent calls and rejects both when it fails", async () => {
    fetchMock.mockImplementationOnce(() => respond({ groups: {}, failed: {} }, 503));

    const calls = [prefetchPoolData(contracts), prefetchPoolData(contracts)];

    await expect(calls[0]).rejects.toThrow("Pool data could not be loaded");
    await expect(calls[1]).rejects.toThrow("Pool data could not be loaded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("prefetchPoolData when a group's rewards are unknown", () => {
  let prefetchPoolData: Awaited<ReturnType<typeof freshPrefetch>>;

  const contracts = [{ protocol: "uniswap", blockchain: "polygon", pool: "0xP", active: true }] as miningContract[];
  const live = { status: "LIVE", apr: 64.8, aprBreakdown: [], dailyRewards: 164.48, subscribedTvlUSD: 92_647, campaignStart: 1, campaignEnd: 2, fetchedAt: 3 };
  const withRewards = { fetchedAt: 5000, indexedAt: 4000, hasIndexingErrors: false, data: [{ ...pool("0xp"), rewards: live }] };
  const rewardsUnknown = { fetchedAt: 6000, indexedAt: 5000, hasIndexingErrors: false, data: [pool("0xp")], rewardsUnavailable: true };

  beforeEach(async () => {
    prefetchPoolData = await freshPrefetch();
  });

  it("keeps the rewards the tab loaded before, and does not cache the load", async () => {
    fetchMock
      .mockImplementationOnce(() => respondGroup("uniswap-polygon", withRewards))
      .mockImplementationOnce(() => respondGroup("uniswap-polygon", rewardsUnknown))
      .mockImplementationOnce(() => respondGroup("uniswap-polygon", rewardsUnknown));

    await prefetchPoolData(contracts, 0);
    const res = await prefetchPoolData(contracts, 0);

    expect(res.uniswapById["polygon:0xp"].rewards).toEqual(live);
    expect(res.meta.fetchedAt).toBe(6000);
    expect(res.meta.rewardsUnavailable).toBeUndefined();

    await prefetchPoolData(contracts);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("names the active group whose rewards are unknown with nothing to fall back on", async () => {
    fetchMock.mockImplementationOnce(() => respondGroup("uniswap-polygon", rewardsUnknown));

    const res = await prefetchPoolData(contracts);

    expect(res.uniswapById["polygon:0xp"].rewards).toBeUndefined();
    expect(res.meta.rewardsUnavailable).toEqual(["uniswap-polygon"]);
    expect(res.meta.failed).toBeUndefined();
  });
});
