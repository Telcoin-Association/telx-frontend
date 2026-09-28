import { MetricsWindow, PoolMetrics } from "@/types/PoolMetrics";

// Activity fields every contract-data type carries, copied from the backend metrics when present.
export type PoolActivityFields = {
  volume24hWindow?: MetricsWindow | null;
  lastActivityAt?: number | null;
  lastSwapAt?: number | null;
  createdAt?: number | null;
};

export function activityFields(metrics: PoolMetrics | null | undefined): PoolActivityFields {
  if (!metrics) return {};
  return {
    volume24hWindow: metrics.window,
    lastActivityAt: metrics.lastActivityAt,
    lastSwapAt: metrics.lastSwapAt,
    createdAt: metrics.createdAt,
  };
}

// The Graph returns numbers as strings; missing or non-numeric values become null.
export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
