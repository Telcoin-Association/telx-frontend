import { programTotals, type AnalyticsDay, type AnalyticsPool, type TotalsDay } from "./analytics";
import {
  MIN_TVL_FOR_FEES_APR,
  nextPeriodStart,
  periodChange,
  periodLabel,
  periodStart,
  poolComparison,
  previousSummary,
  reportSeries,
  summarizePeriods,
  type ReportDay,
} from "./analyticsReports";

const DAY = 86_400;
const utc = (year: number, month: number, date: number) => Date.UTC(year, month - 1, date) / 1000;

const totals = (day: number, fields: Partial<TotalsDay>): TotalsDay => ({
  day,
  tvlUSD: null,
  svlUSD: null,
  volumeUSD: null,
  feesUSD: null,
  rewardsUSD: null,
  telDistributed: null,
  ...fields,
});

const poolDay = (day: number, fields: Partial<AnalyticsDay>): AnalyticsDay => ({
  day,
  tvlUSD: null,
  volumeUSD: null,
  feesUSD: null,
  svlUSD: null,
  apr: null,
  dailyRewardsUSD: null,
  status: null,
  estimated: false,
  ...fields,
});

describe("reportSeries", () => {
  it("works out the subscribed share and the APRs the way the daily report does", () => {
    const [day] = reportSeries([totals(utc(2026, 10, 1), { tvlUSD: 1000, svlUSD: 400, feesUSD: 2, rewardsUSD: 4, volumeUSD: 500 })], {
      [String(utc(2026, 10, 1))]: 0.002,
    });
    expect(day.subscribedShare).toBeCloseTo(0.4);
    expect(day.incentivesApr).toBeCloseTo((4 / 400) * 365);
    expect(day.feesApr).toBeCloseTo((2 / 1000) * 365);
    expect(day.totalApr).toBeCloseTo((4 / 400 + 2 / 1000) * 365);
    expect(day.telUSD).toBe(0.002);
  });

  it("leaves a figure unknown without its base, and totals whichever APR part is known", () => {
    const [noCampaign, nothing] = reportSeries(
      [totals(utc(2026, 10, 1), { tvlUSD: 1000, feesUSD: 1 }), totals(utc(2026, 10, 2), { svlUSD: 0, rewardsUSD: 5 })],
      {},
    );
    expect(noCampaign.incentivesApr).toBeNull();
    expect(noCampaign.totalApr).toBeCloseTo(0.365);
    expect(nothing.incentivesApr).toBeNull();
    expect(nothing.feesApr).toBeNull();
    expect(nothing.totalApr).toBeNull();
    expect(nothing.telUSD).toBeNull();
  });

  it("accumulates volume and fees, skipping unrecorded days", () => {
    const series = reportSeries(
      [
        totals(utc(2026, 10, 1), { volumeUSD: 100, feesUSD: 1 }),
        totals(utc(2026, 10, 2), {}),
        totals(utc(2026, 10, 3), { volumeUSD: 50, feesUSD: 0.5 }),
      ],
      {},
    );
    expect(series.map(day => day.cumulativeVolumeUSD)).toEqual([100, 100, 150]);
    expect(series.map(day => day.cumulativeFeesUSD)).toEqual([1, 1, 1.5]);
  });
});

describe("periods", () => {
  it("starts weeks on Sunday, months on the 1st and quarters on Jan, Apr, Jul and Oct", () => {
    const thursday = utc(2026, 10, 1) + 5 * 3600;
    expect(periodStart(thursday, "day")).toBe(utc(2026, 10, 1));
    expect(periodStart(thursday, "week")).toBe(utc(2026, 9, 27));
    expect(periodStart(thursday, "month")).toBe(utc(2026, 10, 1));
    expect(periodStart(utc(2026, 9, 30), "quarter")).toBe(utc(2026, 7, 1));
    expect(nextPeriodStart(utc(2026, 9, 27), "week")).toBe(utc(2026, 10, 4));
    expect(nextPeriodStart(utc(2026, 12, 1), "month")).toBe(utc(2027, 1, 1));
    expect(nextPeriodStart(utc(2026, 10, 1), "quarter")).toBe(utc(2027, 1, 1));
  });

  it("labels each period", () => {
    expect(periodLabel(utc(2026, 10, 1), "day")).toBe("Oct 1, 2026");
    expect(periodLabel(utc(2026, 9, 27), "week")).toBe("Week of Sep 27, 2026");
    expect(periodLabel(utc(2026, 9, 1), "month")).toBe("September 2026");
    expect(periodLabel(utc(2026, 7, 1), "quarter")).toBe("Q3 2026");
  });
});

describe("summarizePeriods", () => {
  const series = (rows: Array<[number, Partial<TotalsDay>]>): ReportDay[] => reportSeries(rows.map(([day, fields]) => totals(day, fields)), {});

  it("averages the levels and APRs, totals the flows, newest period first", () => {
    const rows = series([
      [utc(2026, 9, 26), { tvlUSD: 900, svlUSD: 300, volumeUSD: 10, feesUSD: 1, rewardsUSD: 3, telDistributed: 1500 }],
      [utc(2026, 9, 27), { tvlUSD: 1000, svlUSD: 400, volumeUSD: 100, feesUSD: 2, rewardsUSD: 4, telDistributed: 2000 }],
      [utc(2026, 9, 28), { tvlUSD: 1200, svlUSD: 600, volumeUSD: 200, feesUSD: 3, rewardsUSD: 6, telDistributed: 3000 }],
    ]);
    const [current, previous] = summarizePeriods(rows, "week", utc(2026, 9, 29));

    expect(current.label).toBe("Week of Sep 27, 2026");
    expect(current.days).toBe(2);
    expect(current.partial).toBe(true);
    expect(current.avgTvlUSD).toBe(1100);
    expect(current.avgSvlUSD).toBe(500);
    expect(current.subscribedShare).toBeCloseTo(500 / 1100);
    expect(current.volumeUSD).toBe(300);
    expect(current.feesUSD).toBe(5);
    expect(current.telDistributed).toBe(5000);
    expect(current.incentivesApr).toBeCloseTo(((4 / 400 + 6 / 600) / 2) * 365);
    expect(current.feesApr).toBeCloseTo(((2 / 1000 + 3 / 1200) / 2) * 365);
    expect(current.totalApr).toBeCloseTo(current.incentivesApr! + current.feesApr!);

    expect(previous.label).toBe("Week of Sep 20, 2026");
    expect(previous.partial).toBe(false);
    expect(previousSummary([current, previous], current, "week")).toBe(previous);
    expect(previousSummary([current, previous], previous, "week")).toBeNull();
  });

  it("compares shares and APRs in points and amounts relative to the previous period", () => {
    const rows = series([
      [utc(2026, 9, 1), { tvlUSD: 1000, svlUSD: 200, volumeUSD: 100, feesUSD: 0 }],
      [utc(2026, 10, 1), { tvlUSD: 1500, svlUSD: 600, volumeUSD: 150, feesUSD: 1 }],
    ]);
    const [october, september] = summarizePeriods(rows, "month", utc(2026, 10, 2));
    const change = periodChange(october, september);
    expect(change.avgTvlUSD).toEqual({ kind: "relative", value: 0.5 });
    expect(change.volumeUSD).toEqual({ kind: "relative", value: 0.5 });
    expect(change.subscribedShare!.kind).toBe("points");
    expect(change.subscribedShare!.value).toBeCloseTo(0.4 - 0.2);
    expect(change.feesUSD).toBeNull();
    expect(change.incentivesApr).toBeNull();
  });
});

describe("summarizePeriods with a campaign starting mid-period", () => {
  const series = (rows: Array<[number, Partial<TotalsDay>]>): ReportDay[] => reportSeries(rows.map(([day, fields]) => totals(day, fields)), {});
  // Sun Sep 27 to Tue Sep 29: tiny TVL before the campaign, then $30k TVL with $29k subscribed.
  const week = series([
    [utc(2026, 9, 27), { tvlUSD: 100, feesUSD: 0.01 }],
    [utc(2026, 9, 28), { tvlUSD: 30_000, svlUSD: 29_000, feesUSD: 30, rewardsUSD: 160 }],
    [utc(2026, 9, 29), { tvlUSD: 32_000, svlUSD: 31_000, feesUSD: 32, rewardsUSD: 160 }],
  ]);

  it("averages SVL over the days with rewards, and the share over the days with both figures", () => {
    const [summary] = summarizePeriods(week, "week", utc(2026, 10, 1));
    expect(summary.days).toBe(3);
    expect(summary.rewardDays).toBe(2);
    expect(summary.avgTvlUSD).toBeCloseTo((100 + 30_000 + 32_000) / 3);
    expect(summary.avgSvlUSD).toBe(30_000);
    expect(summary.subscribedShare).toBeCloseTo(30_000 / 31_000);
  });

  it("applies the same rule to pools summed per day", () => {
    const pools: AnalyticsPool[] = [
      { id: "0xa", chain: "base", name: "eUSD/TEL", days: [poolDay(utc(2026, 9, 27), { tvlUSD: 100 }), poolDay(utc(2026, 9, 28), { tvlUSD: 30_000, svlUSD: 29_000 })] },
      { id: "0xb", chain: "base", name: "ETH/TEL", days: [poolDay(utc(2026, 9, 27), { tvlUSD: 50 }), poolDay(utc(2026, 9, 28), { tvlUSD: 10_000, svlUSD: 9_000 })] },
    ];
    const program = reportSeries(programTotals(pools, {}), {});
    const [summary] = summarizePeriods(program, "week", utc(2026, 10, 1));
    expect(summary.avgSvlUSD).toBe(38_000);
    expect(summary.subscribedShare).toBeCloseTo(38_000 / 40_000);
  });

  it("hides the fees APR, and leaves it out of the total, for an average TVL under the minimum", () => {
    const tiny = series([[utc(2026, 9, 27), { tvlUSD: 11.9, feesUSD: 0.0158 }]]);
    const [summary] = summarizePeriods(tiny, "week", utc(2026, 10, 1));
    expect(MIN_TVL_FOR_FEES_APR).toBe(1_000);
    expect(summary.feesAprHidden).toBe(true);
    expect(summary.feesApr).toBeNull();
    expect(summary.totalApr).toBeNull();
    expect(summarizePeriods(week, "week", utc(2026, 10, 1))[0].feesAprHidden).toBe(false);
  });
});

describe("poolComparison", () => {
  const pools: AnalyticsPool[] = [
    { id: "0xa", chain: "polygon", name: "WETH/TEL", days: [poolDay(utc(2026, 10, 1), { svlUSD: 50, tvlUSD: 100, volumeUSD: 7 })] },
    { id: "0xb", chain: "base", name: "ETH/TEL", days: [poolDay(utc(2026, 10, 2), { volumeUSD: 9 })] },
  ];

  it("puts each pool's figure under its key, null on days it didn't record", () => {
    expect(poolComparison(pools, {}, "volumeUSD")).toEqual([
      { day: utc(2026, 10, 1), "polygon:0xa": 7, "base:0xb": null },
      { day: utc(2026, 10, 2), "base:0xb": 9, "polygon:0xa": null },
    ]);
    expect(poolComparison(pools, {}, "svlUSD")[0]["polygon:0xa"]).toBe(50);
  });

  it("covers every day of the chosen pools", () => {
    expect(poolComparison(pools, {}, "totalApr").map(row => row.day)).toEqual([utc(2026, 10, 1), utc(2026, 10, 1) + DAY]);
  });
});
