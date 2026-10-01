import type { AnalyticsPool, AnalyticsResponse } from "@/server/analytics/series";

export type { AnalyticsCampaign, AnalyticsDay, AnalyticsPool, AnalyticsResponse } from "@/server/analytics/series";

/** Which pools the program totals cover: every pool, a chain's pools, or one pool (by `chain:id`). */
export type AnalyticsFilter = { chain: "all" | "polygon" | "base" | "ethereum"; pool: string | null };

export const poolKey = (pool: Pick<AnalyticsPool, "chain" | "id">) => `${pool.chain}:${pool.id}`;

export function filterAnalyticsPools(pools: readonly AnalyticsPool[], filter: AnalyticsFilter): AnalyticsPool[] {
  return pools.filter(pool => (filter.chain === "all" || pool.chain === filter.chain) && (filter.pool === null || poolKey(pool) === filter.pool));
}

/** The program's figures for one UTC day, summed over the chosen pools. A sum is null when no pool recorded it. */
export type TotalsDay = {
  day: number;
  tvlUSD: number | null;
  svlUSD: number | null;
  volumeUSD: number | null;
  feesUSD: number | null;
  rewardsUSD: number | null;
  /** TEL paid out that day: the rewards in USD at that day's TEL price; null without a price. */
  telDistributed: number | null;
};

const add = (sum: number | null, value: number | null) => (value === null ? sum : (sum ?? 0) + value);

/** Daily totals over `pools`, oldest first, on every day any of them recorded. */
export function programTotals(pools: readonly AnalyticsPool[], telUSD: AnalyticsResponse["telUSD"]): TotalsDay[] {
  const byDay = new Map<number, TotalsDay>();
  for (const pool of pools) {
    for (const day of pool.days) {
      const total = byDay.get(day.day) ?? { day: day.day, tvlUSD: null, svlUSD: null, volumeUSD: null, feesUSD: null, rewardsUSD: null, telDistributed: null };
      total.tvlUSD = add(total.tvlUSD, day.tvlUSD);
      total.svlUSD = add(total.svlUSD, day.svlUSD);
      total.volumeUSD = add(total.volumeUSD, day.volumeUSD);
      total.feesUSD = add(total.feesUSD, day.feesUSD);
      total.rewardsUSD = add(total.rewardsUSD, day.dailyRewardsUSD);
      byDay.set(day.day, total);
    }
  }
  return [...byDay.values()]
    .sort((a, b) => a.day - b.day)
    .map(total => {
      const price = telUSD[String(total.day)];
      return { ...total, telDistributed: total.rewardsUSD !== null && price > 0 ? total.rewardsUSD / price : null };
    });
}

/** One pool's reward efficiency for one UTC day. */
export type PoolRewardsDay = {
  day: number;
  apr: number | null;
  /** Subscribed value as a fraction of TVL. */
  subscribedShare: number | null;
  /** Rewards for a week per $1,000 of subscribed value: what the campaign costs per unit of liquidity it attracts. */
  costPer1kSvlWeekUSD: number | null;
};

export function poolRewardsSeries(pool: AnalyticsPool): PoolRewardsDay[] {
  return pool.days.map(day => ({
    day: day.day,
    apr: day.apr,
    subscribedShare: day.svlUSD !== null && day.tvlUSD !== null && day.tvlUSD > 0 ? day.svlUSD / day.tvlUSD : null,
    costPer1kSvlWeekUSD: day.dailyRewardsUSD !== null && day.svlUSD !== null && day.svlUSD > 0 ? (day.dailyRewardsUSD * 7) / (day.svlUSD / 1000) : null,
  }));
}

/**
 * A pool's current rewards figures: `unrecorded` when its rewards history has no row yet, `noCampaign` when the
 * latest row isn't a live campaign, otherwise the latest day's figures (any of which can still be null).
 */
export type PoolRewardsNow = { state: "unrecorded" } | { state: "noCampaign" } | { state: "live"; figures: PoolRewardsDay };

export function poolRewardsNow(pool: AnalyticsPool): PoolRewardsNow {
  const latest = [...pool.days].reverse().find(day => day.status !== null);
  if (!latest) return { state: "unrecorded" };
  if (latest.status !== "LIVE") return { state: "noCampaign" };
  return { state: "live", figures: poolRewardsSeries({ ...pool, days: [latest] })[0] };
}

/** "2026-10-01" for a UTC day start in unix seconds. */
export const isoDay = (day: number) => new Date(day * 1000).toISOString().slice(0, 10);

/** A CSV column: its header and how to read a row's cell. */
export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null };

const csvCell = (value: string | number | null) => {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** RFC 4180 CSV with a header row; an unknown value is an empty cell. */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  return [columns.map(column => csvCell(column.header)).join(","), ...rows.map(row => columns.map(column => csvCell(column.value(row))).join(","))].join("\r\n");
}

/** Saves `csv` as a file named `filename` in the browser. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
