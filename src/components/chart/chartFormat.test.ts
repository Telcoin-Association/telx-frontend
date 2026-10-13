import { CHART_METRIC_LABELS, describeChartPoint, formatChartAxisDate, formatChartAxisHour, formatChartAxisUSD, formatChartDate, formatChartHour, formatChartUSD, hourlyAxisTicks, isoHour, timeAxisTicks } from "./chartFormat";

describe("chart formatting", () => {
  it("formats day buckets in UTC with the year", () => {
    expect(formatChartDate("2026-09-24")).toBe("Sep 24, 2026");
    expect(formatChartDate("2025-01-01")).toBe("Jan 1, 2025");
    expect(formatChartAxisDate("2026-09-24")).toBe("Sep 24");
  });

  it("returns an unparseable date label unchanged", () => {
    expect(formatChartDate("not a date")).toBe("not a date");
    expect(formatChartAxisDate("not a date")).toBe("not a date");
  });

  it("formats values to the cent at every size, as the headline does", () => {
    expect(formatChartUSD(92262.871)).toBe("$92,262.87");
    expect(formatChartUSD(147933.096)).toBe("$147,933.10");
    expect(formatChartUSD(0)).toBe("$0.00");
    expect(formatChartUSD(999999.994)).toBe("$999,999.99");
    expect(formatChartUSD(1_234_567.89)).toBe("$1,234,567.89");
  });

  it("describes a bar with its metric, date and value for screen readers", () => {
    expect(describeChartPoint("TVL", "2026-09-14", 4000)).toBe("TVL on Sep 14, 2026: $4,000.00");
  });

  it("reports a missing value as Unavailable", () => {
    expect(formatChartUSD(null)).toBe("Unavailable");
    expect(formatChartUSD(undefined)).toBe("Unavailable");
    expect(formatChartUSD(Number.NaN)).toBe("Unavailable");
  });

  it("keeps Y axis ticks compact", () => {
    expect(formatChartAxisUSD(0)).toBe("$0");
    expect(formatChartAxisUSD(950)).toBe("$950");
    expect(formatChartAxisUSD(92262.87)).toBe("$92.3K");
    expect(formatChartAxisUSD(1_200_000)).toBe("$1.2M");
    expect(formatChartAxisUSD(Number.NaN)).toBe("");
  });

  it("names the metrics as the tabs do", () => {
    expect(CHART_METRIC_LABELS).toEqual({ liquidity: "TVL", volume: "Volume", fees: "Fees", svl: "SVL" });
  });
});

describe("hourly labels", () => {
  const HOUR = 1_791_813_600; // 2026-10-12 14:00 UTC
  it("labels an hour in UTC", () => {
    expect(isoHour(HOUR)).toBe("2026-10-12T14:00Z");
    expect(formatChartHour(isoHour(HOUR))).toBe("Oct 12, 2026, 14:00 UTC");
    expect(formatChartAxisHour(isoHour(HOUR))).toBe("14:00");
    expect(formatChartAxisHour(isoHour(HOUR - 14 * 3_600))).toBe("Oct 12");
  });
});

describe("hourlyAxisTicks", () => {
  const hours = (count: number, start = 1_791_763_200) => Array.from({ length: count }, (_, i) => isoHour(start + i * 3_600));
  it("ticks each UTC midnight over two days or more, and leaves shorter spans to the chart", () => {
    expect(hourlyAxisTicks(hours(72))).toEqual(["2026-10-12T00:00Z", "2026-10-13T00:00Z", "2026-10-14T00:00Z"]);
    expect(hourlyAxisTicks(hours(30))).toBeUndefined();
  });
});

describe("timeAxisTicks", () => {
  const at = (iso: string) => Date.parse(iso);
  const labels = (from: string, to: string) => {
    const axis = timeAxisTicks(at(from), at(to));
    return axis.ticks.map(axis.format);
  };

  it("ticks by the hour over a few hours, and gives the date at midnight", () => {
    expect(labels("2026-10-12T09:00Z", "2026-10-12T14:00Z")).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"]);
    expect(labels("2026-10-11T20:00Z", "2026-10-13T08:00Z")).toEqual(["Oct 12", "12:00", "Oct 13"]);
  });

  it("ticks by date over days and weeks, at UTC midnight", () => {
    expect(labels("2026-10-01T00:00Z", "2026-10-11T00:00Z")).toEqual(["Oct 2", "Oct 4", "Oct 6", "Oct 8", "Oct 10"]);
    const axis = timeAxisTicks(at("2026-08-20T00:00Z"), at("2026-10-12T14:00Z"));
    expect(axis.ticks.length).toBeLessThanOrEqual(6);
    expect(axis.ticks.every(tick => tick % 86_400_000 === 0)).toBe(true);
  });

  it("ticks on the first of the month over months", () => {
    expect(labels("2026-07-05T00:00Z", "2026-10-03T00:00Z")).toEqual(["Aug 1", "Sep 1", "Oct 1"]);
  });

  it("gives a single point one tick", () => {
    expect(timeAxisTicks(at("2026-10-12T14:00Z"), at("2026-10-12T14:00Z")).ticks).toEqual([at("2026-10-12T14:00Z")]);
  });
});
