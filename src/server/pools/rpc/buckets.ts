import "server-only";

import type { SwapValue } from "./swapMath";

/**
 * Swap totals per pool: 5-minute buckets kept for 48 hours, which give the trailing 24h metrics and the
 * hourly rows, and UTC day rows kept for 95 days, which give the daily rows and carry each day's TVL.
 */

export const BUCKET_SECONDS = 300;
export const HOUR = 3600;
export const DAY = 86400;
export const BUCKET_RETENTION = 48 * HOUR;
export const DAY_ROWS = 95;
const HOURLY_ROWS = 48;

export type Bucket = { swaps: number; volumeUSD: number; feesUSD: number; lpFeesUSD: number; protocolFeesUSD: number; lastSwapAt: number };
export type DayRow = { swaps: number; volumeUSD: number; feesUSD: number; lpFeesUSD: number; tvlUSD: number | null };

export const bucketStart = (ts: number) => Math.floor(ts / BUCKET_SECONDS) * BUCKET_SECONDS;
export const hourStart = (ts: number) => Math.floor(ts / HOUR) * HOUR;
export const dayStart = (ts: number) => Math.floor(ts / DAY) * DAY;

const emptyBucket = (): Bucket => ({ swaps: 0, volumeUSD: 0, feesUSD: 0, lpFeesUSD: 0, protocolFeesUSD: 0, lastSwapAt: 0 });
export const emptyDay = (): DayRow => ({ swaps: 0, volumeUSD: 0, feesUSD: 0, lpFeesUSD: 0, tvlUSD: null });

/** Adds a priced swap to its bucket and day row. Returns the keys it changed. */
export function addSwap(buckets: Map<number, Bucket>, days: Map<number, DayRow>, ts: number, value: SwapValue): { bucket: number; day: number } {
  const bucketKey = bucketStart(ts);
  const bucket = buckets.get(bucketKey) ?? emptyBucket();
  bucket.swaps += 1;
  bucket.volumeUSD += value.volumeUSD;
  bucket.feesUSD += value.feesUSD;
  bucket.lpFeesUSD += value.lpFeesUSD;
  bucket.protocolFeesUSD += value.protocolFeesUSD;
  bucket.lastSwapAt = Math.max(bucket.lastSwapAt, ts);
  buckets.set(bucketKey, bucket);

  const dayKey = dayStart(ts);
  const day = days.get(dayKey) ?? emptyDay();
  day.swaps += 1;
  day.volumeUSD += value.volumeUSD;
  day.feesUSD += value.feesUSD;
  day.lpFeesUSD += value.lpFeesUSD;
  days.set(dayKey, day);
  return { bucket: bucketKey, day: dayKey };
}

/**
 * Buckets inside the trailing 24 hours that end at `asOf`. A bucket is inside when any part of it is, so a
 * swap exactly 24 hours old counts and the window is exact to five minutes.
 */
export function inWindow(buckets: ReadonlyMap<number, Bucket>, asOf: number): Bucket[] {
  return [...buckets].filter(([start]) => start + BUCKET_SECONDS > asOf - DAY && start <= asOf).map(([, bucket]) => bucket);
}

/** Sums of the trailing 24 hours. */
export function trailing24h(buckets: ReadonlyMap<number, Bucket>, asOf: number): { swaps: number; volumeUSD: number; feesUSD: number } {
  let swaps = 0;
  let volumeUSD = 0;
  let feesUSD = 0;
  for (const bucket of inWindow(buckets, asOf)) {
    swaps += bucket.swaps;
    volumeUSD += bucket.volumeUSD;
    feesUSD += bucket.feesUSD;
  }
  return { swaps, volumeUSD, feesUSD };
}

export type HourRow = { periodStartUnix: number; volumeUSD: number; feesUSD: number; txCount: number };

/** One row per hour for the 48 hours up to `asOf` (the current hour first), quiet hours as zero, none before `createdAt`. */
export function hourlyRows(buckets: ReadonlyMap<number, Bucket>, asOf: number, createdAt: number): HourRow[] {
  const rows: HourRow[] = [];
  const current = hourStart(asOf);
  for (let i = 0; i < HOURLY_ROWS; i++) {
    const start = current - i * HOUR;
    if (start + HOUR <= createdAt) break;
    rows.push({ periodStartUnix: start, volumeUSD: 0, feesUSD: 0, txCount: 0 });
  }
  for (const [key, bucket] of buckets) {
    const row = rows[(current - hourStart(key)) / HOUR];
    if (!row || key > asOf) continue;
    row.volumeUSD += bucket.volumeUSD;
    row.feesUSD += bucket.feesUSD;
    row.txCount += bucket.swaps;
  }
  return rows;
}

export type DailyRow = { timestamp: number; tvlUSD: number; volumeUSD: number; feesUSD: number; txCount: number };

/**
 * One row per UTC day from the pool's creation (at most DAY_ROWS days) to the day of `asOf`, newest first.
 * A day without a stored row has no swaps and keeps the TVL of the day before it; days before the first
 * recorded TVL are left out.
 */
export function dailyRows(days: ReadonlyMap<number, DayRow>, asOf: number, createdAt: number): DailyRow[] {
  const today = dayStart(asOf);
  const first = Math.max(dayStart(createdAt), today - (DAY_ROWS - 1) * DAY);
  let tvl: number | null = null;
  for (const [key, row] of [...days].sort(([a], [b]) => a - b)) if (key < first && row.tvlUSD !== null) tvl = row.tvlUSD;

  const rows: DailyRow[] = [];
  for (let day = first; day <= today; day += DAY) {
    const row = days.get(day);
    if (row?.tvlUSD !== null && row?.tvlUSD !== undefined) tvl = row.tvlUSD;
    if (tvl === null) continue;
    rows.push({ timestamp: day, tvlUSD: tvl, volumeUSD: row?.volumeUSD ?? 0, feesUSD: row?.feesUSD ?? 0, txCount: row?.swaps ?? 0 });
  }
  return rows.reverse();
}

/** Bucket and day keys past their retention at `asOf`. */
export function expiredKeys(
  buckets: ReadonlyMap<number, unknown>,
  days: ReadonlyMap<number, unknown>,
  asOf: number,
): { buckets: number[]; days: number[] } {
  const bucketCutoff = asOf - BUCKET_RETENTION;
  const dayCutoff = dayStart(asOf) - DAY_ROWS * DAY;
  return {
    buckets: [...buckets.keys()].filter(key => key + BUCKET_SECONDS <= bucketCutoff),
    days: [...days.keys()].filter(key => key < dayCutoff),
  };
}
