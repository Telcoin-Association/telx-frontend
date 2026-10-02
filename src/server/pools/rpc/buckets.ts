import "server-only";

import type { SwapValue } from "./swapMath";

/**
 * Swap totals per pool: 5-minute buckets kept for 48 hours, which give the trailing 24h metrics and the
 * hourly rows, and UTC day rows kept for good, which give the daily rows and carry each day's TVL and
 * closing price. The closing fields are the pool's state at the last chunk folded in that day, so a day in
 * progress carries its latest values. The pool payload shows the last DAY_ROWS days; the analytics read all
 * of them.
 */

export const BUCKET_SECONDS = 300;
export const HOUR = 3600;
export const DAY = 86400;
export const BUCKET_RETENTION = 48 * HOUR;
/** Days of daily rows in the pool payload and a position's history; the stored day rows are never trimmed. */
export const DAY_ROWS = 95;
const HOURLY_ROWS = 48;

export type Bucket = { swaps: number; volumeUSD: number; feesUSD: number; lpFeesUSD: number; protocolFeesUSD: number; lastSwapAt: number };
export type DayRow = {
  swaps: number;
  volumeUSD: number;
  feesUSD: number;
  lpFeesUSD: number;
  tvlUSD: number | null;
  /** Closing pool price and tick, absent on rows written before the pipeline stored them. */
  sqrtPriceX96?: string | null;
  tick?: number | null;
  /** Closing USD prices of currency0 and currency1, as the chunk priced them. */
  price0USD?: number | null;
  price1USD?: number | null;
};

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

/** The first day of the DAY_ROWS-day window that ends on the day of `asOf`. */
export const windowStart = (asOf: number) => dayStart(asOf) - (DAY_ROWS - 1) * DAY;

/**
 * The newest TVL stored before `first`: the latest row before it in `days` that has one, or `previous` (the
 * newest TVL before some earlier day, covering rows `days` does not hold) when none does.
 */
export function newestTvlBefore(days: ReadonlyMap<number, DayRow>, first: number, previous: number | null): number | null {
  let newest: { day: number; tvl: number } | null = null;
  for (const [day, row] of days) if (day < first && row.tvlUSD !== null && (newest === null || day > newest.day)) newest = { day, tvl: row.tvlUSD };
  return newest?.tvl ?? previous;
}

/**
 * One row per UTC day from the pool's creation (at most DAY_ROWS days) to the day of `asOf`, newest first.
 * A day without a stored row has no swaps and keeps the TVL of the day before it; days before the first
 * recorded TVL are left out. `tvlBefore` is the newest TVL before the rows `days` holds, for a caller that
 * read only recent rows; rows in `days` before the window override it.
 */
export function dailyRows(days: ReadonlyMap<number, DayRow>, asOf: number, createdAt: number, tvlBefore: number | null = null): DailyRow[] {
  const today = dayStart(asOf);
  const first = Math.max(dayStart(createdAt), windowStart(asOf));
  let tvl: number | null = tvlBefore;
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

/** Bucket keys past BUCKET_RETENTION at `asOf`. Day rows have no retention: every day is kept. */
export function expiredBuckets(buckets: ReadonlyMap<number, unknown>, asOf: number): number[] {
  const bucketCutoff = asOf - BUCKET_RETENTION;
  return [...buckets.keys()].filter(key => key + BUCKET_SECONDS <= bucketCutoff);
}
