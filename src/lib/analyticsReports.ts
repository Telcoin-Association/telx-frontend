import { programTotals, poolKey, subscribedShareOf, type AnalyticsPool, type AnalyticsResponse, type TotalsDay } from "./analytics";

/*
 * Report figures in the definitions of the TELx daily report:
 * - subscribed share = SVL / TVL ("staked LPTs %");
 * - incentives APR = rewards USD per day / SVL × 365;
 * - fees APR = fees USD per day / TVL × 365;
 * - total APR = incentives APR + fees APR.
 * APRs and shares are fractions (0.25 is 25%). Every series is oldest first.
 */

const DAY_SECONDS = 86_400;
const DAYS_PER_YEAR = 365;

const ratio = (numerator: number | null, denominator: number | null) =>
  numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;

/** One UTC day of a report series: the program's, or one pool's. */
export type ReportDay = TotalsDay & {
  subscribedShare: number | null;
  incentivesApr: number | null;
  feesApr: number | null;
  /** Fees APR plus incentives APR; one of them alone when only it is known, null when neither is. */
  totalApr: number | null;
  /** Volume and fees summed from the first day of the series. */
  cumulativeVolumeUSD: number | null;
  cumulativeFeesUSD: number | null;
  telUSD: number | null;
};

/** Adds the report's derived figures to daily totals, with TEL's price for each day. */
export function reportSeries(totals: readonly TotalsDay[], telUSD: AnalyticsResponse["telUSD"]): ReportDay[] {
  let volume: number | null = null;
  let fees: number | null = null;
  return totals.map(day => {
    const incentivesApr = ratio(day.rewardsUSD, day.svlUSD);
    const feesApr = ratio(day.feesUSD, day.tvlUSD);
    if (day.volumeUSD !== null) volume = (volume ?? 0) + day.volumeUSD;
    if (day.feesUSD !== null) fees = (fees ?? 0) + day.feesUSD;
    const price = telUSD[String(day.day)];
    return {
      ...day,
      subscribedShare: subscribedShareOf(day.svlUSD, day.tvlUSD),
      incentivesApr: incentivesApr === null ? null : incentivesApr * DAYS_PER_YEAR,
      feesApr: feesApr === null ? null : feesApr * DAYS_PER_YEAR,
      totalApr: incentivesApr === null && feesApr === null ? null : ((incentivesApr ?? 0) + (feesApr ?? 0)) * DAYS_PER_YEAR,
      cumulativeVolumeUSD: volume,
      cumulativeFeesUSD: fees,
      telUSD: typeof price === "number" && price > 0 ? price : null,
    };
  });
}

/** One pool's report series. */
export const poolReportSeries = (pool: AnalyticsPool, telUSD: AnalyticsResponse["telUSD"]) => reportSeries(programTotals([pool], telUSD), telUSD);

/** The figures a pool comparison chart can plot, one series per pool. */
export type ComparisonMetric = "svlUSD" | "volumeUSD" | "totalApr";

/** One row per day with each pool's figure under its `poolKey`, for a multi-line chart. */
export type ComparisonRow = { day: number } & Record<string, number | null>;

export function poolComparison(pools: readonly AnalyticsPool[], telUSD: AnalyticsResponse["telUSD"], metric: ComparisonMetric): ComparisonRow[] {
  const rows = new Map<number, ComparisonRow>();
  for (const pool of pools) {
    for (const day of poolReportSeries(pool, telUSD)) {
      const row = rows.get(day.day) ?? ({ day: day.day } as ComparisonRow);
      row[poolKey(pool)] = day[metric];
      rows.set(day.day, row);
    }
  }
  const keys = pools.map(poolKey);
  return [...rows.values()]
    .sort((a, b) => a.day - b.day)
    .map(row => {
      for (const key of keys) if (!(key in row)) row[key] = null;
      return row;
    });
}

/** The report periods. Weeks run Sunday to Saturday, as in the daily report's weekly sheets. */
export type ReportPeriod = "day" | "week" | "month" | "quarter";

export const REPORT_PERIODS: readonly ReportPeriod[] = ["day", "week", "month", "quarter"];

/** The UTC start (unix seconds) of the period containing `day`. */
export function periodStart(day: number, period: ReportPeriod): number {
  const date = new Date(day * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startOfDay = Date.UTC(year, month, date.getUTCDate()) / 1000;
  if (period === "day") return startOfDay;
  if (period === "week") return startOfDay - date.getUTCDay() * DAY_SECONDS;
  if (period === "month") return Date.UTC(year, month, 1) / 1000;
  return Date.UTC(year, month - (month % 3), 1) / 1000;
}

/** The UTC start of the period after the one starting at `start`. */
export function nextPeriodStart(start: number, period: ReportPeriod): number {
  if (period === "day") return start + DAY_SECONDS;
  if (period === "week") return start + 7 * DAY_SECONDS;
  const date = new Date(start * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + (period === "month" ? 1 : 3), 1) / 1000;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map(month => month.slice(0, 3));

/** "Oct 1, 2026", "Week of Sep 27, 2026", "September 2026" or "Q3 2026". */
export function periodLabel(start: number, period: ReportPeriod): string {
  const date = new Date(start * 1000);
  const year = date.getUTCFullYear();
  const dayText = `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${year}`;
  if (period === "day") return dayText;
  if (period === "week") return `Week of ${dayText}`;
  if (period === "month") return `${MONTHS[date.getUTCMonth()]} ${year}`;
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${year}`;
}

/** One period's summary: averages of the daily figures that were recorded, and totals of the flows. */
export type PeriodSummary = {
  start: number;
  /** The start of the next period: the summary covers days from `start` up to, not including, `end`. */
  end: number;
  label: string;
  /** Days in the period that have a row. */
  days: number;
  /** The period hasn't ended yet, so its totals are to date. */
  partial: boolean;
  avgTvlUSD: number | null;
  avgSvlUSD: number | null;
  /** Average SVL over average TVL, as the report works out the period's staked share. */
  subscribedShare: number | null;
  incentivesApr: number | null;
  feesApr: number | null;
  totalApr: number | null;
  volumeUSD: number | null;
  feesUSD: number | null;
  rewardsUSD: number | null;
  telDistributed: number | null;
};

const average = (values: readonly (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
};

const total = (values: readonly (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};

/**
 * The series summarised by period, newest first. A period is `partial` while `now` (unix seconds) falls before its
 * end. APRs are the average of the daily APRs; the total APR is the sum of the averaged parts.
 */
export function summarizePeriods(series: readonly ReportDay[], period: ReportPeriod, now: number): PeriodSummary[] {
  const groups = new Map<number, ReportDay[]>();
  for (const day of series) {
    const start = periodStart(day.day, period);
    groups.set(start, [...(groups.get(start) ?? []), day]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([start, days]) => {
      const end = nextPeriodStart(start, period);
      const avgTvlUSD = average(days.map(day => day.tvlUSD));
      const avgSvlUSD = average(days.map(day => day.svlUSD));
      const incentivesApr = average(days.map(day => day.incentivesApr));
      const feesApr = average(days.map(day => day.feesApr));
      return {
        start,
        end,
        label: periodLabel(start, period),
        days: days.length,
        partial: now < end,
        avgTvlUSD,
        avgSvlUSD,
        subscribedShare: subscribedShareOf(avgSvlUSD, avgTvlUSD),
        incentivesApr,
        feesApr,
        totalApr: incentivesApr === null && feesApr === null ? null : (incentivesApr ?? 0) + (feesApr ?? 0),
        volumeUSD: total(days.map(day => day.volumeUSD)),
        feesUSD: total(days.map(day => day.feesUSD)),
        rewardsUSD: total(days.map(day => day.rewardsUSD)),
        telDistributed: total(days.map(day => day.telDistributed)),
      };
    });
}

/** The figures a period summary compares with the previous period. */
export const SUMMARY_FIGURES = [
  "avgTvlUSD",
  "avgSvlUSD",
  "subscribedShare",
  "incentivesApr",
  "feesApr",
  "totalApr",
  "volumeUSD",
  "feesUSD",
  "telDistributed",
] as const;

export type SummaryFigure = (typeof SUMMARY_FIGURES)[number];

/** Shares and APRs change in percentage points; amounts change relative to the previous period. */
const POINT_FIGURES: ReadonlySet<SummaryFigure> = new Set(["subscribedShare", "incentivesApr", "feesApr", "totalApr"]);

export type FigureChange = { kind: "points" | "relative"; value: number };

/** How each figure moved from `previous` to `current`; null where either is unknown or a relative change has no base. */
export function periodChange(current: PeriodSummary, previous: PeriodSummary): Record<SummaryFigure, FigureChange | null> {
  const changes = {} as Record<SummaryFigure, FigureChange | null>;
  for (const figure of SUMMARY_FIGURES) {
    const now = current[figure];
    const before = previous[figure];
    if (now === null || before === null) changes[figure] = null;
    else if (POINT_FIGURES.has(figure)) changes[figure] = { kind: "points", value: now - before };
    else changes[figure] = before === 0 ? null : { kind: "relative", value: (now - before) / before };
  }
  return changes;
}

/** The summary of the period immediately before `summary`, if the list has one. */
export function previousSummary(summaries: readonly PeriodSummary[], summary: PeriodSummary, period: ReportPeriod): PeriodSummary | null {
  return summaries.find(candidate => nextPeriodStart(candidate.start, period) === summary.start) ?? null;
}
