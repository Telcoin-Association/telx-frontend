/**
 * @jest-environment node
 */
import { deriveUniswapMetrics } from "./metrics";
import { groupByPoolId, withMetrics } from "./normalizeSubgraphData";

const NOW = 20510 * 86400 + 12 * 3600;

describe("groupByPoolId", () => {
  it("drops rows for pools that were not requested", () => {
    const groups = groupByPoolId({
      pools: [{ id: "0xAAA", totalValueLockedUSD: "1" }],
      poolSnapshots: [
        { pool: { id: "0xaaa" }, periodStartUnix: 1 },
        { pool: { id: "0xbbb" }, periodStartUnix: 2 },
      ],
      threeMonthLiquidityData: [{ pool: { id: "0xBBB" }, timestamp: 3 }],
    });

    expect(groups.map(group => group.id)).toEqual(["0xaaa"]);
    expect(groups[0].poolSnapshots).toEqual([{ pool: { id: "0xaaa" }, periodStartUnix: 1 }]);
    expect(groups[0].threeMonthLiquidityData).toEqual([]);
  });

  it("keeps a requested pool that has no rows", () => {
    const groups = groupByPoolId({
      pools: [{ id: "0xa" }, { id: "0xb" }],
      poolSnapshots: [{ pool: { id: "0xa" }, periodStartUnix: 1 }],
      threeMonthLiquidityData: [],
    });

    expect(groups).toHaveLength(2);
    expect(groups[1]).toEqual({ id: "0xb", pool: { id: "0xb" }, poolSnapshots: [], threeMonthLiquidityData: [] });
  });

  it("matches quickswap rows by poolAddress, case-insensitively", () => {
    const row = { poolAddress: "0xABC", date: 1, dailyVolumeUSD: "5" };
    const [group] = groupByPoolId({ pools: [{ id: "0xabc" }], poolSnapshots: [row], threeMonthLiquidityData: [row] });

    expect(group.poolSnapshots).toEqual([row]);
    expect(group.threeMonthLiquidityData).toEqual([row]);
  });

  it("attaches swaps by poolId.id when the response has a swaps selection", () => {
    const swapA = { id: "s1", timestamp: 10, valueUSD: "3", poolId: { id: "0xA" } };
    const groups = groupByPoolId({
      pools: [{ id: "0xa" }, { id: "0xb" }],
      poolSnapshots: [],
      swaps: [swapA, { id: "s2", timestamp: 11, valueUSD: "4", poolId: { id: "0xc" } }],
    });

    expect(groups[0].swaps).toEqual([swapA]);
    expect(groups[1].swaps).toEqual([]);
  });

  it("omits the swaps key when the response has no swaps selection", () => {
    const [group] = groupByPoolId({ pools: [{ id: "0xa" }], poolSnapshots: [] });

    expect(group).not.toHaveProperty("swaps");
  });

  it("tolerates missing arrays and rows without a pool reference", () => {
    const historyOnly = groupByPoolId({ pools: [{ id: "0xa" }], threeMonthLiquidityData: [{ pool: { id: "0xa" }, timestamp: 1 }] });
    expect(historyOnly[0].poolSnapshots).toEqual([]);
    expect(historyOnly[0].threeMonthLiquidityData).toHaveLength(1);

    const hourlyOnly = groupByPoolId({ pools: [{ id: "0xa" }], poolSnapshots: [{ periodStartUnix: 1 }, { pool: null }] });
    expect(hourlyOnly[0].poolSnapshots).toEqual([]);
    expect(hourlyOnly[0].threeMonthLiquidityData).toEqual([]);

    expect(groupByPoolId({ pools: [{ id: "0xa" }] })).toEqual([{ id: "0xa", pool: { id: "0xa" }, poolSnapshots: [], threeMonthLiquidityData: [] }]);
    expect(groupByPoolId({})).toEqual([]);
    expect(groupByPoolId(undefined)).toEqual([]);
  });
});

describe("withMetrics", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("attaches metrics derived for the protocol without mutating the input", () => {
    const groups = groupByPoolId({
      pools: [{ id: "0xa", totalValueLockedUSD: "10" }],
      poolSnapshots: [{ pool: { id: "0xa" }, periodStartUnix: NOW - 60, volumeUSD: "7", feesUSD: "0.021" }],
    });
    const [group] = withMetrics(groups, "uniswap", NOW);

    expect(group.metrics).toEqual(deriveUniswapMetrics(groups[0], NOW));
    expect(group.metrics).toMatchObject({ tvlUSD: 10, volume24h: 7, window: "trailing-24h", computedAt: NOW });
    expect(group.poolSnapshots).toBe(groups[0].poolSnapshots);
    expect(groups[0]).not.toHaveProperty("metrics");
  });

  it("uses the attached swaps for balancer", () => {
    const groups = groupByPoolId({
      pools: [{ id: "0xa", totalLiquidity: "100", swapFee: "0.01" }],
      poolSnapshots: [],
      swaps: [{ timestamp: NOW - 60, valueUSD: "50", poolId: { id: "0xa" } }],
    });
    const [group] = withMetrics(groups, "balancer", NOW);

    expect(group.metrics).toMatchObject({ volume24h: 50, fees24h: 0.5, window: "trailing-24h", rows24h: 1 });
  });

  it("defaults now to the current time in unix seconds", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW * 1000 + 999));
    const [group] = withMetrics(groupByPoolId({ pools: [{ id: "0xa" }], poolSnapshots: [] }), "quickswap");

    expect(group.metrics.computedAt).toBe(NOW);
  });
});
