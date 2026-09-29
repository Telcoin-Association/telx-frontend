/**
 * @jest-environment node
 */
import {
  BalancerDailyResponseSchema,
  BalancerGroupedResponseSchema,
  BalancerHourlyResponseSchema,
  MetricsSchema,
  QuickswapGroupedResponseSchema,
  SubgraphMetaSchema,
  UniswapDailyResponseSchema,
  UniswapGroupedResponseSchema,
  UniswapHourlyResponseSchema,
} from "./schemas";
import { deriveMetrics, type MetricsProtocol } from "./metrics";
import balancerGroupedData from "./__fixtures__/balancer-grouped.json";
import quickswapGroupedData from "./__fixtures__/quickswap-grouped.json";
import uniswapBaseGroupedData from "./__fixtures__/uniswap-base-grouped.json";
import uniswapPolygonGroupedData from "./__fixtures__/uniswap-polygon-grouped.json";
import uniswapEthereumGroupedData from "./__fixtures__/uniswap-ethereum-grouped.json";

describe("Schema Validations", () => {
  it("should validate BalancerGroupedResponseSchema correctly", () => {
    // we expect the schema to parse the data successfully without throwing an error
    const result = BalancerGroupedResponseSchema.safeParse(balancerGroupedData);

    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(result.error);
    }
  });

  it("should fail BalancerGroupedResponseSchema when data is invalid", () => {
    // modify a required field to be missing or wrong type
    const invalidData = [
      {
        ...balancerGroupedData[0],
        id: 123, // id should be string
      },
    ];

    const result = BalancerGroupedResponseSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should validate QuickswapGroupedResponseSchema", () => {
    const result = QuickswapGroupedResponseSchema.safeParse(quickswapGroupedData);
    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(result.error);
    }
  });

  it("should validate UniswapGroupedResponseSchema for base", () => {
    const result = UniswapGroupedResponseSchema.safeParse(uniswapBaseGroupedData);
    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(result.error);
    }
  });

  it("should validate UniswapGroupedResponseSchema for polygon", () => {
    const result = UniswapGroupedResponseSchema.safeParse(uniswapPolygonGroupedData);
    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(result.error);
    }
  });

  it("should validate UniswapGroupedResponseSchema for ethereum", () => {
    const result = UniswapGroupedResponseSchema.safeParse(uniswapEthereumGroupedData);
    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(result.error);
    }
  });
});

const NOW = 1772107200;

// Copies each group without the given keys, e.g. to turn a merged fixture into an hourly or daily payload.
function omitKeys(groups: object[], ...keys: string[]): Record<string, unknown>[] {
  return groups.map(group => Object.fromEntries(Object.entries(group).filter(([key]) => !keys.includes(key))));
}

function withDerivedMetrics<G extends Record<string, unknown>>(groups: G[], protocol: MetricsProtocol) {
  return groups.map(group => ({ ...group, metrics: deriveMetrics(protocol, group, NOW) }));
}

describe("zero-activity fixture pools", () => {
  it.each([
    ["balancer", balancerGroupedData, BalancerGroupedResponseSchema],
    ["quickswap", quickswapGroupedData, QuickswapGroupedResponseSchema],
    ["uniswap base", uniswapBaseGroupedData, UniswapGroupedResponseSchema],
    ["uniswap polygon", uniswapPolygonGroupedData, UniswapGroupedResponseSchema],
    ["uniswap ethereum", uniswapEthereumGroupedData, UniswapGroupedResponseSchema],
  ] as const)("%s fixture has a pool with no rows that validates", (_name, data, schema) => {
    const zeroPools = (data as { poolSnapshots: unknown[]; threeMonthLiquidityData: unknown[] }[]).filter(
      group => group.poolSnapshots.length === 0 && group.threeMonthLiquidityData.length === 0,
    );

    expect(zeroPools).toHaveLength(1);
    expect(schema.safeParse(zeroPools).success).toBe(true);
  });
});

describe("merged schemas with metrics", () => {
  it("keeps metrics and swaps on the merged balancer shape", () => {
    const result = BalancerGroupedResponseSchema.safeParse(balancerGroupedData);
    expect(result.success).toBe(true);

    const zeroPool = result.data?.find(group => group.poolSnapshots.length === 0);
    expect(zeroPool?.swaps).toEqual([]);
    expect(zeroPool?.metrics).toMatchObject({ volume24h: 0, window: "trailing-24h", lastActivityAt: null });
  });

  it("keeps metrics on the merged uniswap shape", () => {
    const result = UniswapGroupedResponseSchema.safeParse(uniswapBaseGroupedData);
    expect(result.success).toBe(true);

    const zeroPool = result.data?.find(group => group.poolSnapshots.length === 0);
    expect(zeroPool?.metrics).toMatchObject({ volume24h: 0, fees24h: 0, rows24h: 0, computedAt: NOW });
    expect(zeroPool?.pool.createdAtTimestamp).toBe("1735689600");
  });

  it("rejects a merged payload with malformed metrics", () => {
    const [first] = uniswapBaseGroupedData;
    const result = UniswapGroupedResponseSchema.safeParse([{ ...first, metrics: { volume24h: "12" } }]);
    expect(result.success).toBe(false);
  });

  it("requires metrics on quickswap pools", () => {
    expect(QuickswapGroupedResponseSchema.safeParse(omitKeys(quickswapGroupedData, "metrics")).success).toBe(false);
  });
});

describe("hourly schemas", () => {
  it("fails a uniswap hourly payload without metrics", () => {
    const hourly = omitKeys(uniswapPolygonGroupedData, "threeMonthLiquidityData", "metrics");
    expect(UniswapHourlyResponseSchema.safeParse(hourly).success).toBe(false);
  });

  it("passes a uniswap hourly payload with derived metrics and drops daily rows", () => {
    const hourly = withDerivedMetrics(omitKeys(uniswapPolygonGroupedData, "threeMonthLiquidityData", "metrics"), "uniswap");
    const result = UniswapHourlyResponseSchema.safeParse(hourly);

    expect(result.success).toBe(true);
    expect(result.data?.[0].metrics.window).toBe("trailing-24h");
    expect(result.data?.[0]).not.toHaveProperty("threeMonthLiquidityData");
  });

  it("fails a balancer hourly payload without metrics", () => {
    const hourly = omitKeys(balancerGroupedData, "threeMonthLiquidityData", "metrics");
    expect(BalancerHourlyResponseSchema.safeParse(hourly).success).toBe(false);
  });

  it("passes a balancer hourly payload with swaps and derived metrics", () => {
    const hourly = withDerivedMetrics(omitKeys(balancerGroupedData, "threeMonthLiquidityData", "metrics"), "balancer").map(group => ({
      ...group,
      swaps: [{ id: "0xswap", timestamp: NOW - 60, valueUSD: "25", poolId: { id: group.id } }],
    }));
    const result = BalancerHourlyResponseSchema.safeParse(hourly);

    expect(result.success).toBe(true);
    expect(result.data?.[0].swaps).toHaveLength(1);
  });

  it("rejects an empty hourly payload", () => {
    expect(UniswapHourlyResponseSchema.safeParse([]).success).toBe(false);
    expect(BalancerHourlyResponseSchema.safeParse([]).success).toBe(false);
  });
});

describe("daily schemas", () => {
  it("passes daily payloads and drops hourly fields", () => {
    const uniswap = UniswapDailyResponseSchema.safeParse(omitKeys(uniswapBaseGroupedData, "poolSnapshots", "metrics"));
    const balancer = BalancerDailyResponseSchema.safeParse(omitKeys(balancerGroupedData, "poolSnapshots", "swaps", "metrics"));

    expect(uniswap.success).toBe(true);
    expect(balancer.success).toBe(true);
    expect(uniswap.data?.[0]).not.toHaveProperty("poolSnapshots");
  });

  it("fails a daily payload without threeMonthLiquidityData", () => {
    expect(UniswapDailyResponseSchema.safeParse(omitKeys(uniswapBaseGroupedData, "threeMonthLiquidityData")).success).toBe(false);
  });
});

describe("MetricsSchema and SubgraphMetaSchema", () => {
  it("accepts derived metrics and rejects an unknown window", () => {
    const metrics = deriveMetrics("uniswap", { pool: { totalValueLockedUSD: "1" }, poolSnapshots: [] }, NOW);

    expect(MetricsSchema.safeParse(metrics).success).toBe(true);
    expect(MetricsSchema.safeParse({ ...metrics, window: "yesterday" }).success).toBe(false);
  });

  it("accepts a null or missing block timestamp", () => {
    expect(SubgraphMetaSchema.safeParse({ block: { number: 1, timestamp: 1772107200 }, hasIndexingErrors: false }).success).toBe(true);
    expect(SubgraphMetaSchema.safeParse({ block: { number: 1, timestamp: null }, hasIndexingErrors: true }).success).toBe(true);
    expect(SubgraphMetaSchema.safeParse({ block: { number: 1 }, hasIndexingErrors: false }).success).toBe(true);
    expect(SubgraphMetaSchema.safeParse({ block: { number: 1 } }).success).toBe(false);
  });
});
