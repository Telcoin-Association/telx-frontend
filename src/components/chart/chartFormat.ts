/**
 * Formatting for the pool page charts (TVL, Volume, Fees, SVL). Chart dates are "YYYY-MM-DD" day buckets in UTC,
 * so they are formatted in UTC to keep the label on the day the bucket belongs to in every time zone.
 */

export type ChartMetric = "liquidity" | "volume" | "fees" | "svl";

/** Metric names shown in the tooltip, matching the chart tabs. */
export const CHART_METRIC_LABELS: Record<ChartMetric, string> = {
  liquidity: "TVL",
  volume: "Volume",
  fees: "Fees",
  svl: "SVL",
};

const fullDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdAxis = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

function parseChartDate(isoDate: string): Date | null {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-09-24" -> "Sep 24, 2026". An unparseable label is returned unchanged. */
export function formatChartDate(isoDate: string): string {
  const date = parseChartDate(isoDate);
  return date ? fullDate.format(date) : isoDate;
}

/** "2026-09-24" -> "Sep 24", for X axis ticks. An unparseable label is returned unchanged. */
export function formatChartAxisDate(isoDate: string): string {
  const date = parseChartDate(isoDate);
  return date ? shortDate.format(date) : isoDate;
}

/**
 * A bar's value, to the cent, in the tooltip and in the headline while that bar is active, so the one figure
 * reads the same in both places.
 */
export function formatChartUSD(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "Unavailable";
  return usdCents.format(value);
}

/** What a screen reader hears for the active bar, once the pointer or selection settles on it. */
export function describeChartPoint(metricLabel: string, isoDate: string, value: number): string {
  return `${metricLabel} on ${formatChartDate(isoDate)}: ${formatChartUSD(value)}`;
}

/** Y axis tick: always compact ("$0", "$950", "$92.3K", "$1.2M"). */
export function formatChartAxisUSD(value: number): string {
  return Number.isFinite(value) ? usdAxis.format(value) : "";
}

const hourLabel = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** An hourly point's label: "YYYY-MM-DDTHH:00Z", the start of the UTC hour. */
export function isoHour(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 13)}:00Z`;
}

/** "2026-10-12T14:00Z" -> "Oct 12, 2026, 14:00 UTC". An unparseable label is returned unchanged. */
export function formatChartHour(isoTime: string): string {
  const date = parseChartDate(isoTime);
  return date ? `${fullDate.format(date)}, ${hourLabel.format(date)} UTC` : isoTime;
}

/** X axis tick for an hourly chart: the date at midnight UTC ("Oct 12"), the hour otherwise ("14:00"). */
export function formatChartAxisHour(isoTime: string): string {
  const date = parseChartDate(isoTime);
  if (!date) return isoTime;
  return date.getUTCHours() === 0 ? shortDate.format(date) : hourLabel.format(date);
}

/**
 * X axis ticks for an hourly chart that spans two days or more: one per UTC midnight, so the axis reads as dates
 * and the tooltip gives the hour. Undefined for a shorter span, where the axis picks hours itself.
 */
export function hourlyAxisTicks(isoTimes: readonly string[]): string[] | undefined {
  if (isoTimes.length < 48) return undefined;
  const midnights = isoTimes.filter(time => time.endsWith("T00:00Z"));
  return midnights.length >= 2 ? midnights : undefined;
}
