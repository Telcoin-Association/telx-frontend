/**
 * A pool's subscribed liquidity (SVL) by UTC day, as `/api/pools/svl` serves it: the Merkl cron's daily figure,
 * or the rewards backfill's estimate before the cron recorded one (`estimated`). Only days a campaign was live
 * have a figure.
 */
export type SvlDay = {
  /** "YYYY-MM-DD", the same day labels as the pool charts. */
  date: string;
  svlUSD: number;
  estimated: boolean;
};

export type SvlResponse = { days: SvlDay[] };

/** "YYYY-MM-DD" for a UTC day start in unix seconds. */
export function svlDateLabel(dayStart: number): string {
  return new Date(dayStart * 1000).toISOString().slice(0, 10);
}

/**
 * SVL in the pool charts' series convention: values oldest first, labels newest first (`buildChartData` flips
 * the labels to line them up).
 */
export function svlChartSeries(days: readonly SvlDay[]): { weights: number[]; labels: string[] } {
  return { weights: days.map(day => day.svlUSD), labels: days.map(day => day.date).reverse() };
}

/** SVL keyed by day label, for drawing it over the TVL bars. */
export function svlByDate(days: readonly SvlDay[]): Record<string, number> {
  return Object.fromEntries(days.map(day => [day.date, day.svlUSD]));
}

/** The day labels whose SVL is the backfill's estimate. */
export function estimatedSvlDates(days: readonly SvlDay[]): ReadonlySet<string> {
  return new Set(days.filter(day => day.estimated).map(day => day.date));
}

/** Reads the series from an `/api/pools/svl` body, dropping anything malformed. */
export function parseSvlResponse(body: unknown): SvlDay[] {
  const days = (body as Partial<SvlResponse> | null)?.days;
  if (!Array.isArray(days)) return [];
  return days.filter(
    (day): day is SvlDay =>
      typeof day?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date) && Number.isFinite(day?.svlUSD) && typeof day?.estimated === "boolean",
  );
}
