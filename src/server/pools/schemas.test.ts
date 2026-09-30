/**
 * @jest-environment node
 */
import { MetricsSchema, UniswapGroupedResponseSchema } from "./schemas";
import uniswapPolygonV3Data from "./__fixtures__/uniswap-polygon-grouped.v3.json";

describe("UniswapGroupedResponseSchema", () => {
  it("validates the RPC pipeline's payload and keeps every field the readers use", () => {
    const result = UniswapGroupedResponseSchema.safeParse(uniswapPolygonV3Data);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(uniswapPolygonV3Data);
  });

  it("rejects an empty payload and a pool without its pool entity", () => {
    expect(UniswapGroupedResponseSchema.safeParse([]).success).toBe(false);
    const [first] = uniswapPolygonV3Data as Record<string, unknown>[];
    const { pool: _pool, ...withoutPool } = first;
    expect(UniswapGroupedResponseSchema.safeParse([withoutPool]).success).toBe(false);
  });
});

describe("MetricsSchema", () => {
  const metrics = {
    tvlUSD: 1,
    volume24h: 2,
    fees24h: 0.01,
    window: "trailing-24h",
    lastActivityAt: null,
    lastSwapAt: null,
    createdAt: null,
    rows24h: 3,
    computedAt: 1772107200,
  };

  it("accepts the pipeline's metrics, including a withheld window", () => {
    expect(MetricsSchema.safeParse(metrics).success).toBe(true);
    expect(MetricsSchema.safeParse({ ...metrics, volume24h: null, fees24h: null, window: null }).success).toBe(true);
  });

  it("rejects an unknown window", () => {
    expect(MetricsSchema.safeParse({ ...metrics, window: "utc-day" }).success).toBe(false);
  });
});
