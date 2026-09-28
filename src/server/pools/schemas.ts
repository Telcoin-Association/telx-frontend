import "server-only";

import { z } from "zod";

import type { PoolMetrics } from "./metrics";

export const MetricsSchema = z.object({
  tvlUSD: z.number().nullable(),
  volume24h: z.number().nullable(),
  fees24h: z.number().nullable(),
  window: z.enum(["trailing-24h", "trailing-24h-interpolated", "utc-day"]).nullable(),
  lastActivityAt: z.number().nullable(),
  lastSwapAt: z.number().nullable(),
  createdAt: z.number().nullable(),
  rows24h: z.number().int().nonnegative(),
  computedAt: z.number(),
}) satisfies z.ZodType<PoolMetrics>;

export const SubgraphMetaSchema = z.object({
  block: z.object({
    number: z.number(),
    timestamp: z.number().nullable().optional(),
    __typename: z.string().optional(),
  }),
  hasIndexingErrors: z.boolean(),
  __typename: z.string().optional(),
});

export const BalancerPoolSchema = z.object({
  id: z.string(),
  address: z.string(),
  totalLiquidity: z.union([z.string(), z.number()]),
  totalSwapFee: z.union([z.string(), z.number()]),
  swapFee: z.union([z.string(), z.number()]),
  createTime: z.union([z.number(), z.string()]).optional(),
  __typename: z.string().optional(),
});

export const BalancerSnapshotSchema = z.object({
  timestamp: z.number(),
  swapFees: z.union([z.string(), z.number()]),
  swapVolume: z.union([z.string(), z.number()]),
  liquidity: z.union([z.string(), z.number()]).optional(),
  pool: z.object({
    id: z.string(),
    address: z.string(),
    __typename: z.string().optional(),
  }),
  __typename: z.string().optional(),
});

export const BalancerSwapSchema = z.object({
  id: z.string().optional(),
  timestamp: z.number(),
  valueUSD: z.union([z.string(), z.number()]),
  poolId: z.object({
    id: z.string(),
    __typename: z.string().optional(),
  }),
  __typename: z.string().optional(),
});

// merged read shape (hourly + daily parts)
export const BalancerGroupedPoolSchema = z.object({
  id: z.string(),
  pool: BalancerPoolSchema,
  poolSnapshots: z.array(BalancerSnapshotSchema),
  threeMonthLiquidityData: z.array(BalancerSnapshotSchema),
  swaps: z.array(BalancerSwapSchema).optional(),
  metrics: MetricsSchema.nullable().optional(),
});

export const BalancerGroupedResponseSchema = z.array(BalancerGroupedPoolSchema).nonempty();

export const BalancerHourlyGroupedPoolSchema = z.object({
  id: z.string(),
  pool: BalancerPoolSchema,
  poolSnapshots: z.array(BalancerSnapshotSchema),
  swaps: z.array(BalancerSwapSchema).optional(),
  metrics: MetricsSchema,
});

export const BalancerHourlyResponseSchema = z.array(BalancerHourlyGroupedPoolSchema).nonempty();

export const BalancerDailyGroupedPoolSchema = z.object({
  id: z.string(),
  pool: BalancerPoolSchema,
  threeMonthLiquidityData: z.array(BalancerSnapshotSchema),
});

export const BalancerDailyResponseSchema = z.array(BalancerDailyGroupedPoolSchema).nonempty();

// quickswap schemas
export const QuickswapPoolSchema = z.object({
  id: z.string(),
  reserveUSD: z.union([z.string(), z.number()]),
  createdAtTimestamp: z.union([z.string(), z.number()]).optional(),
  __typename: z.string().optional(),
});

export const QuickswapSnapshotSchema = z.object({
  date: z.number(),
  dailyVolumeUSD: z.union([z.string(), z.number()]),
  poolAddress: z.string(),
  __typename: z.string().optional(),
});

export const QuickswapthreeMonthDataSchema = z.object({
  date: z.number(),
  reserveUSD: z.union([z.string(), z.number()]),
  poolAddress: z.string(),
  dailyVolumeUSD: z.union([z.string(), z.number()]),
  __typename: z.string().optional(),
});

export const QuickswapGroupedPoolSchema = z.object({
  id: z.string(),
  pool: QuickswapPoolSchema,
  poolSnapshots: z.array(QuickswapSnapshotSchema),
  threeMonthLiquidityData: z.array(QuickswapthreeMonthDataSchema),
  metrics: MetricsSchema,
});

export const QuickswapGroupedResponseSchema = z.array(QuickswapGroupedPoolSchema).nonempty();

// uniswap schemas
export const UniswapPoolSchema = z.object({
  id: z.string(),
  totalValueLockedUSD: z.union([z.string(), z.number()]),
  feesUSD: z.union([z.string(), z.number()]),
  createdAtTimestamp: z.union([z.string(), z.number()]).optional(),
  __typename: z.string().optional(),
});

export const UniswapSnapshotSchema = z.object({
  pool: z.object({
    id: z.string(),
    __typename: z.string().optional(),
  }),
  periodStartUnix: z.number(),
  volumeUSD: z.union([z.string(), z.number()]),
  feesUSD: z.union([z.string(), z.number()]),
  __typename: z.string().optional(),
});

export const UniswapthreeMonthDataSchema = z.object({
  pool: z.object({
    id: z.string(),
    __typename: z.string().optional(),
  }),
  timestamp: z.number(),
  tvlUSD: z.union([z.string(), z.number()]),
  feesUSD: z.union([z.string(), z.number()]),
  volumeUSD: z.union([z.string(), z.number()]),
  __typename: z.string().optional(),
});

// merged read shape (hourly + daily parts)
export const UniswapGroupedPoolSchema = z.object({
  id: z.string(),
  pool: UniswapPoolSchema,
  poolSnapshots: z.array(UniswapSnapshotSchema),
  threeMonthLiquidityData: z.array(UniswapthreeMonthDataSchema),
  metrics: MetricsSchema.nullable().optional(),
});

export const UniswapGroupedResponseSchema = z.array(UniswapGroupedPoolSchema).nonempty();

export const UniswapHourlyGroupedPoolSchema = z.object({
  id: z.string(),
  pool: UniswapPoolSchema,
  poolSnapshots: z.array(UniswapSnapshotSchema),
  metrics: MetricsSchema,
});

export const UniswapHourlyResponseSchema = z.array(UniswapHourlyGroupedPoolSchema).nonempty();

export const UniswapDailyGroupedPoolSchema = z.object({
  id: z.string(),
  pool: UniswapPoolSchema,
  threeMonthLiquidityData: z.array(UniswapthreeMonthDataSchema),
});

export const UniswapDailyResponseSchema = z.array(UniswapDailyGroupedPoolSchema).nonempty();
