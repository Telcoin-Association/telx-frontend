/**
 * @jest-environment node
 */
import { MAX_PAGES, PAGE_SIZE } from "../graph";
import { poolsFor } from "../registry";
import { fakeClient, type QueryResult } from "../testing";
import { fetchBalancerHourly } from "./balancer";
import { fetchQuickswapGrouped } from "./quickswap";
import { fetchUniswapHourly } from "./uniswap";

const DAY = 86400;
const DAY_START = 20510 * DAY; // a UTC midnight
const NOW = DAY_START + 12 * 3600; // midday UTC
const meta = { block: { number: 1, timestamp: NOW - 30 }, hasIndexingErrors: false };

const uniswapPool = (id: string) => ({ id, totalValueLockedUSD: "10", feesUSD: "1", createdAtTimestamp: "1700000000" });

describe("missing pools", () => {
  const base = poolsFor("uniswap", "base");
  const activeIds = base.filter(pool => pool.active).map(pool => pool.id);
  const archivedIds = base.filter(pool => !pool.active).map(pool => pool.id);

  it("has active and archived pools on Uniswap base to test with", () => {
    expect(activeIds.length).toBeGreaterThan(0);
    expect(archivedIds.length).toBeGreaterThan(0);
  });

  it("keeps going with a warning when the subgraph does not return an archived pool", async () => {
    const { client } = fakeClient({ data: { pools: activeIds.map(uniswapPool), poolSnapshots: [], _meta: meta } });

    const result = await fetchUniswapHourly("base", { client, now: NOW });

    expect(result.groups.map(group => group.id).sort()).toEqual([...activeIds].sort());
    expect(result.warnings).toEqual([`Uniswap base hourly: subgraph did not return archived pools ${archivedIds.join(", ")}`]);
    expect(result.indexedAt).toBe((NOW - 30) * 1000);
  });

  it("fails when the subgraph does not return an active pool", async () => {
    const [missing, ...rest] = activeIds;
    const { client } = fakeClient({ data: { pools: [...rest, ...archivedIds].map(uniswapPool), poolSnapshots: [], _meta: meta } });

    await expect(fetchUniswapHourly("base", { client, now: NOW })).rejects.toThrow(`Uniswap base hourly: subgraph did not return pools ${missing}`);
  });

  it("returns no warnings when every pool came back", async () => {
    const ids = poolsFor("quickswap", "polygon").map(pool => pool.id);
    const { client } = fakeClient({ data: { pools: ids.map(id => ({ id, reserveUSD: "5" })), threeMonthLiquidityData: [], _meta: meta } });

    const result = await fetchQuickswapGrouped({ client, now: NOW });

    expect(result.warnings).toEqual([]);
    expect(result.groups).toHaveLength(ids.length);
  });
});

describe("fetchBalancerHourly", () => {
  const ids = poolsFor("balancer", "polygon").map(pool => pool.id);
  const pools = ids.map(id => ({ id, address: id.slice(0, 42), totalLiquidity: "1000", totalSwapFee: "1", swapFee: "0.01", createTime: 1 }));
  const snapshot = (poolId: string, timestamp: number, swapVolume: string) => ({ timestamp, swapVolume, swapFees: "0", pool: { id: poolId } });
  const poolSnapshots = ids.flatMap(id => [snapshot(id, DAY_START - 2 * DAY, "1000"), snapshot(id, DAY_START - DAY, "1600"), snapshot(id, DAY_START, "1900")]);
  const swapPage = (page: number, size: number) =>
    Array.from({ length: size }, (_, i) => ({
      id: `swap-${String(page * PAGE_SIZE + i).padStart(6, "0")}`,
      timestamp: NOW - 60,
      valueUSD: "1",
      poolId: { id: ids[0] },
    }));

  it("derives trailing-24h metrics from the swaps when they fit", async () => {
    const { client } = fakeClient({ data: { pools, poolSnapshots, swaps: swapPage(0, 3), _meta: meta } });

    const result = await fetchBalancerHourly({ client, now: NOW });

    expect(result.warnings).toEqual([]);
    const first = result.groups.find(group => group.id === ids[0]);
    expect(first?.metrics).toMatchObject({ window: "trailing-24h", volume24h: 3, rows24h: 3 });
    expect(first).not.toHaveProperty("swaps");
  });

  it("falls back to interpolating the snapshots when the swaps overflow the page cap", async () => {
    const fullPages: QueryResult[] = Array.from({ length: MAX_PAGES }, (_, page) => ({
      data: { pools, poolSnapshots, swaps: swapPage(page, PAGE_SIZE), _meta: meta },
    }));
    const { client, query } = fakeClient(...fullPages, { data: { pools, poolSnapshots, _meta: meta } });

    const result = await fetchBalancerHourly({ client, now: NOW });

    expect(query).toHaveBeenCalledTimes(MAX_PAGES + 1);
    expect(query.mock.calls[MAX_PAGES][0].variables).toEqual({ poolIds: ids, snapshotMinDate: DAY_START - 2 * DAY });
    expect(result.warnings).toEqual(["Balancer hourly: too many swaps in the last 24h to page through; metrics interpolated from daily snapshots"]);
    expect(result.groups).toHaveLength(ids.length);
    for (const group of result.groups) {
      expect(group.metrics.window).toBe("trailing-24h-interpolated");
      expect(group.metrics.volume24h).toBeCloseTo(600, 10);
      expect(group).not.toHaveProperty("swaps");
    }
    expect(result.indexedAt).toBe((NOW - 30) * 1000);
  });

  it("still fails on errors other than the page cap", async () => {
    const { client } = fakeClient({ data: { pools }, errors: [{ message: "indexer down" }] });

    await expect(fetchBalancerHourly({ client, now: NOW })).rejects.toThrow("Balancer hourly: indexer down");
  });
});
