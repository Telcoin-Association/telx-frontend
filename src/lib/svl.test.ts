import { estimatedSvlDates, parseSvlResponse, svlByDate, svlChartSeries, svlDateLabel } from "./svl";

const days = [
  { date: "2026-09-25", svlUSD: 50, estimated: true },
  { date: "2026-09-26", svlUSD: 60, estimated: false },
];

describe("svl helpers", () => {
  it("labels a UTC day start", () => {
    expect(svlDateLabel(Date.UTC(2026, 8, 25) / 1000)).toBe("2026-09-25");
  });

  it("builds the chart series with labels newest first, as the pool charts expect", () => {
    expect(svlChartSeries(days)).toEqual({ weights: [50, 60], labels: ["2026-09-26", "2026-09-25"] });
  });

  it("keys SVL by date and lists the estimated dates", () => {
    expect(svlByDate(days)).toEqual({ "2026-09-25": 50, "2026-09-26": 60 });
    expect([...estimatedSvlDates(days)]).toEqual(["2026-09-25"]);
  });

  it("keeps only well-formed days from a response", () => {
    expect(parseSvlResponse({ days: [...days, { date: "bad", svlUSD: 1, estimated: false }, { date: "2026-09-27", svlUSD: "1", estimated: false }] })).toEqual(days);
    expect(parseSvlResponse(null)).toEqual([]);
    expect(parseSvlResponse({ error: "x" })).toEqual([]);
  });
});
