import { CHART_METRIC_LABELS, describeChartPoint, formatChartAxisDate, formatChartAxisUSD, formatChartDate, formatChartUSD } from "./chartFormat";

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
