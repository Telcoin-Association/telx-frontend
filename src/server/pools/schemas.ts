import "server-only";

import { z } from "zod";

import type { PoolMetrics } from "@/types/PoolMetrics";

// Schemas for the RPC pipeline's payload, validated before a cron run writes it (runCronWrite).

export const MetricsSchema = z.object({
  tvlUSD: z.number().nullable(),
  volume24h: z.number().nullable(),
  fees24h: z.number().nullable(),
  window: z.enum(["trailing-24h"]).nullable(),
  lastActivityAt: z.number().nullable(),
  lastSwapAt: z.number().nullable(),
  createdAt: z.number().nullable(),
  rows24h: z.number().int().nonnegative(),
  computedAt: z.number(),
}) satisfies z.ZodType<PoolMetrics>;

export const UniswapPoolSchema = z.object({
  id: z.string(),
  // Null when the RPC pipeline could not value the pool (no reserves or price); readers show it as unknown.
  totalValueLockedUSD: z.union([z.string(), z.number()]).nullable(),
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

// One pool as the RPC pipeline writes it to `active-uniswap-<chain>-grouped:v3` and /api/pools serves it.
export const UniswapGroupedPoolSchema = z.object({
  id: z.string(),
  pool: UniswapPoolSchema,
  poolSnapshots: z.array(UniswapSnapshotSchema),
  threeMonthLiquidityData: z.array(UniswapthreeMonthDataSchema),
  metrics: MetricsSchema.nullable().optional(),
});

export const UniswapGroupedResponseSchema = z.array(UniswapGroupedPoolSchema).nonempty();
