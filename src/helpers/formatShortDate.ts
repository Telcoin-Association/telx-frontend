/**
 * Short UTC date for a unix timestamp in seconds, e.g. "Sep 20", with the year added when it is not the
 * current UTC year. Dates are UTC like the pool charts, so a day reads the same in every time zone. An
 * invalid or out-of-range timestamp gives "an unknown date" rather than throwing during render.
 */
export default function formatShortDate(unixSeconds: number, now: Date = new Date()): string {
  const date = new Date(unixSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return "an unknown date";
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  if (date.getUTCFullYear() !== now.getUTCFullYear()) options.year = "numeric";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}
