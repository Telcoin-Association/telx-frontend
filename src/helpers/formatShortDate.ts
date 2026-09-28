// Short date for a unix timestamp in seconds, e.g. "Sep 20". Adds the year when it is not the current year.
export default function formatShortDate(unixSeconds: number, now: Date = new Date()): string {
  const date = new Date(unixSeconds * 1000);
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}
