import { filterAnalyticsPools, poolRewardsSeries, programTotals, toCsv, type AnalyticsDay, type AnalyticsPool } from "./analytics";

const D1 = 1_790_726_400;
const D2 = D1 + 86_400;

const day = (dayStart: number, fields: Partial<AnalyticsDay> = {}): AnalyticsDay => ({
  day: dayStart,
  tvlUSD: null,
  volumeUSD: null,
  feesUSD: null,
  svlUSD: null,
  apr: null,
  dailyRewardsUSD: null,
  status: null,
  ...fields,
});

const pools: AnalyticsPool[] = [
  { id: "0xa", chain: "polygon", name: "WETH/TEL", days: [day(D1, { tvlUSD: 100, svlUSD: 40, volumeUSD: 10, feesUSD: 1, dailyRewardsUSD: 20 }), day(D2, { tvlUSD: 120 })] },
  { id: "0xb", chain: "base", name: "ETH/TEL", days: [day(D1, { tvlUSD: 50, dailyRewardsUSD: 10 })] },
];

describe("analytics helpers", () => {
  it("filters by chain and by one pool", () => {
    expect(filterAnalyticsPools(pools, { chain: "base", pool: null }).map(pool => pool.id)).toEqual(["0xb"]);
    expect(filterAnalyticsPools(pools, { chain: "all", pool: "polygon:0xa" }).map(pool => pool.id)).toEqual(["0xa"]);
    expect(filterAnalyticsPools(pools, { chain: "base", pool: "polygon:0xa" })).toEqual([]);
  });

  it("sums the chosen pools per day, null where no pool recorded a figure, with TEL at that day's price", () => {
    expect(programTotals(pools, { [String(D1)]: 0.002 })).toEqual([
      { day: D1, tvlUSD: 150, svlUSD: 40, volumeUSD: 10, feesUSD: 1, rewardsUSD: 30, telDistributed: 15_000 },
      { day: D2, tvlUSD: 120, svlUSD: null, volumeUSD: null, feesUSD: null, rewardsUSD: null, telDistributed: null },
    ]);
  });

  it("leaves TEL distributed unknown on a day without a TEL price", () => {
    expect(programTotals(pools, {})[0].telDistributed).toBeNull();
  });

  it("works out each day's subscribed share and the week's rewards per $1k of SVL", () => {
    const pool: AnalyticsPool = { id: "0xa", chain: "polygon", name: "WETH/TEL", days: [day(D1, { tvlUSD: 200, svlUSD: 50, dailyRewardsUSD: 10, apr: 73 }), day(D2, { tvlUSD: 0, svlUSD: 0 })] };
    expect(poolRewardsSeries(pool)).toEqual([
      { day: D1, apr: 73, subscribedShare: 0.25, costPer1kSvlWeekUSD: 1_400 },
      { day: D2, apr: null, subscribedShare: null, costPer1kSvlWeekUSD: null },
    ]);
  });

  it("writes CSV with a header, empty cells for unknowns, and quoted text that needs it", () => {
    const csv = toCsv(
      [
        { header: "name", value: (row: { name: string; value: number | null }) => row.name },
        { header: "value", value: (row: { name: string; value: number | null }) => row.value },
      ],
      [
        { name: "WETH/TEL", value: 1.5 },
        { name: 'a "quoted", name', value: null },
      ],
    );
    expect(csv).toBe('name,value\r\nWETH/TEL,1.5\r\n"a ""quoted"", name",');
  });
});
