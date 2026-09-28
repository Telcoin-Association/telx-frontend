import "server-only";

import type { MetricsWindow, PoolMetrics } from "@/types/PoolMetrics";

export type { MetricsWindow, PoolMetrics };

export type MetricsProtocol = "uniswap" | "balancer" | "quickswap";

/** A subgraph entity or row as it arrives from The Graph (numeric fields are usually strings). */
export type Row = Record<string, unknown>;

export type MetricsInput = {
  pool?: Row | null;
  poolSnapshots?: Row[] | null;
  swaps?: Row[] | null;
};

const DAY = 86400;
const QUICKSWAP_FEE_RATE = 0.003;

/** `Number()` conversion where null, undefined, blank strings and non-finite results count as missing. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type Timed = { t: number; row: Row };

/** Rows paired with their numeric time field; rows without a usable time are dropped. */
function timed(rows: Row[], field: string): Timed[] {
  const out: Timed[] = [];
  for (const row of rows) {
    const t = toNumber(row[field]);
    if (t !== null) out.push({ t, row });
  }
  return out;
}

function newest(items: Timed[]): Timed | null {
  let best: Timed | null = null;
  for (const item of items) if (best === null || item.t > best.t) best = item;
  return best;
}

function newestWithPositive(items: Timed[], field: string): number | null {
  return newest(items.filter(item => (toNumber(item.row[field]) ?? 0) > 0))?.t ?? null;
}

function sumOf(items: Timed[], field: string): number {
  let total = 0;
  for (const item of items) total += toNumber(item.row[field]) ?? 0;
  return total;
}

function arrayOrNull(rows: Row[] | null | undefined): Row[] | null {
  return Array.isArray(rows) ? rows : null;
}

function baseMetrics(now: number): PoolMetrics {
  return {
    tvlUSD: null,
    volume24h: null,
    fees24h: null,
    window: null,
    lastActivityAt: null,
    lastSwapAt: null,
    createdAt: null,
    rows24h: 0,
    computedAt: now,
  };
}

export function deriveUniswapMetrics(group: MetricsInput, now: number): PoolMetrics {
  const metrics = baseMetrics(now);
  const rows = arrayOrNull(group.poolSnapshots);
  const hours = timed(rows ?? [], "periodStartUnix");
  const inWindow = hours.filter(hour => hour.t >= now - DAY);

  metrics.rows24h = inWindow.length;
  metrics.lastActivityAt = newest(hours)?.t ?? null;
  metrics.lastSwapAt = newestWithPositive(hours, "volumeUSD");

  const pool = group.pool;
  if (!pool) return metrics;
  metrics.tvlUSD = toNumber(pool.totalValueLockedUSD);
  metrics.createdAt = toNumber(pool.createdAtTimestamp);
  if (rows) {
    metrics.volume24h = sumOf(inWindow, "volumeUSD");
    metrics.fees24h = sumOf(inWindow, "feesUSD");
    metrics.window = "trailing-24h";
  }
  return metrics;
}

type Point = { t: number; v: number };

/**
 * Cumulative points for interpolation. A Balancer snapshot stamped at the start of a UTC day holds
 * the pool totals as of the last event inside that day, so its value is plotted at the end of the
 * day, or at `now` for the current day.
 */
function cumulativeSeries(snapshots: Timed[], field: string, now: number): Point[] {
  return seriesOf(snapshots, field).map(point => ({ t: Math.min(point.t + DAY, now), v: point.v }));
}

function seriesOf(snapshots: Timed[], field: string): Point[] {
  const points: Point[] = [];
  for (const { t, row } of snapshots) {
    const v = toNumber(row[field]);
    if (v !== null) points.push({ t, v });
  }
  return points.sort((a, b) => a.t - b.t);
}

/**
 * Change of a cumulative series between `cutoff` and its last point. The series is piecewise-linear
 * between daily snapshots, constant after the last one and unknown before the first one.
 */
function trailingDelta(points: Point[], cutoff: number): number | null {
  if (points.length === 0) return 0;
  const last = points[points.length - 1];
  if (cutoff >= last.t) return 0;
  if (cutoff < points[0].t) return null;

  // points[i] is the last point at or before the cutoff; points[i + 1] exists because cutoff < last.t.
  let i = 0;
  while (points[i + 1].t <= cutoff) i++;
  const a = points[i];
  const b = points[i + 1];
  const atCutoff = a.v + ((b.v - a.v) * (cutoff - a.t)) / (b.t - a.t);
  return Math.max(0, last.v - atCutoff);
}

export function deriveBalancerMetrics(group: MetricsInput, now: number): PoolMetrics {
  const metrics = baseMetrics(now);
  const cutoff = now - DAY;
  const snapshotRows = arrayOrNull(group.poolSnapshots);
  const snapshots = timed(snapshotRows ?? [], "timestamp");
  const swapRows = arrayOrNull(group.swaps);
  const swaps = swapRows ? timed(swapRows, "timestamp") : null;
  const swapsInWindow = (swaps ?? []).filter(swap => swap.t >= cutoff);
  const volumeSeries = seriesOf(snapshots, "swapVolume");

  metrics.lastActivityAt = newest(swaps ?? [])?.t ?? newest(snapshots)?.t ?? null;
  if (swaps) {
    metrics.rows24h = swapsInWindow.length;
    metrics.lastSwapAt = newest(swaps)?.t ?? null;
  } else {
    // Without swap rows, count the snapshots inside the window.
    metrics.rows24h = volumeSeries.filter(point => point.t >= cutoff).length;
    for (let i = volumeSeries.length - 1; i > 0; i--) {
      if (volumeSeries[i].v > volumeSeries[i - 1].v) {
        metrics.lastSwapAt = volumeSeries[i].t;
        break;
      }
    }
  }

  const pool = group.pool;
  if (!pool) return metrics;
  metrics.tvlUSD = toNumber(pool.totalLiquidity);
  metrics.createdAt = toNumber(pool.createTime);
  if (swaps) {
    const volume = sumOf(swapsInWindow, "valueUSD");
    const swapFee = toNumber(pool.swapFee);
    metrics.volume24h = volume;
    metrics.fees24h = swapFee === null ? null : volume * swapFee;
    metrics.window = "trailing-24h";
  } else if (snapshotRows) {
    metrics.volume24h = trailingDelta(cumulativeSeries(snapshots, "swapVolume", now), cutoff);
    metrics.fees24h = trailingDelta(cumulativeSeries(snapshots, "swapFees", now), cutoff);
    metrics.window = metrics.volume24h === null ? null : "trailing-24h-interpolated";
  }
  return metrics;
}

export function deriveQuickswapMetrics(group: MetricsInput, now: number): PoolMetrics {
  const metrics = baseMetrics(now);
  const rows = arrayOrNull(group.poolSnapshots);
  const days = timed(rows ?? [], "date");
  const latest = newest(days);
  const todayRow = latest !== null && latest.t === Math.floor(now / DAY) * DAY ? latest.row : null;

  metrics.rows24h = todayRow ? 1 : 0;
  metrics.lastActivityAt = latest?.t ?? null;
  metrics.lastSwapAt = newestWithPositive(days, "dailyVolumeUSD");

  const pool = group.pool;
  if (!pool) return metrics;
  metrics.tvlUSD = toNumber(pool.reserveUSD);
  metrics.createdAt = toNumber(pool.createdAtTimestamp);
  if (rows) {
    // No row for the current UTC day means no swaps today.
    const volume = todayRow ? toNumber(todayRow.dailyVolumeUSD) : 0;
    metrics.volume24h = volume;
    metrics.fees24h = volume === null ? null : volume * QUICKSWAP_FEE_RATE;
    metrics.window = volume === null ? null : "utc-day";
  }
  return metrics;
}

export function deriveMetrics(protocol: MetricsProtocol, group: MetricsInput, now: number): PoolMetrics {
  switch (protocol) {
    case "uniswap":
      return deriveUniswapMetrics(group, now);
    case "balancer":
      return deriveBalancerMetrics(group, now);
    case "quickswap":
      return deriveQuickswapMetrics(group, now);
  }
}
