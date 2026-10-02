import reportHistory from "../data/report-history.json";
import { programTotals, type AnalyticsDay, type AnalyticsPool, type AnalyticsResponse } from "./analytics";
import {
  analyticsPoolLabel,
  archiveFromReport,
  archivePoolId,
  lastRecordedDay,
  limitToRange,
  rangeNeedsArchive,
  rangeStart,
  withArchive,
  type ReportHistoryFile,
} from "./analyticsArchive";
import { reportSeries, summarizePeriods } from "./analyticsReports";

const DAY = 86_400;
const utc = (year: number, month: number, date: number) => Date.UTC(year, month - 1, date) / 1000;

const POOL_FIELDS = ["day", "tvlUSD", "stakedShare", "stakedUSD", "incentivesApr", "volumeUSD", "feesUSD", "feesApr", "totalApr"];
const PROGRAM_FIELDS = [...POOL_FIELDS, "telUSD"];

const D1 = utc(2025, 9, 1);
const D2 = D1 + DAY;

const file = (overrides: Partial<ReportHistoryFile> = {}): ReportHistoryFile => ({
  source: "TELx daily report",
  from: D1,
  to: D2,
  poolFields: POOL_FIELDS,
  programFields: PROGRAM_FIELDS,
  pools: [
    {
      key: "balancer-tel-weth",
      name: "TEL/WETH",
      label: "TEL 80 WETH 20",
      chain: "polygon",
      protocol: "balancer",
      address: "0xCA6E",
      days: [
        [D1, 1000, 0.9, 900, 0.365, 50, 0.1, 0.0365, 0.4015],
        [D2, 1100, null, null, null, 60, 0.12, null, null],
      ],
    },
    {
      key: "uniswap-v4-2025-base-tel-eth",
      name: "TEL/ETH",
      label: "TEL/ETH, Uniswap v4 (2025)",
      chain: "base",
      protocol: "uniswap",
      address: null,
      candidates: ["0x727b", "0xb6d0"],
      days: [[D2, 500, 1, 500, 0.73, 10, 0.03, 0.0219, 0.7519]],
    },
  ],
  program: [
    [D1, 1000, 0.9, 900, 0.365, 50, 0.1, 0.0365, 0.4015, 0.004],
    [D2, 1600, 0.3, 500, 0.73, 70, 0.15, 0.03, 0.76, null],
  ],
  ...overrides,
});

const liveDay = (day: number, fields: Partial<AnalyticsDay> = {}): AnalyticsDay => ({
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

const live = (pools: AnalyticsPool[], overrides: Partial<AnalyticsResponse> = {}): AnalyticsResponse => ({
  historyFrom: utc(2026, 9, 23),
  rewardsFrom: utc(2026, 9, 25),
  pools,
  campaigns: [],
  telUSD: { [String(utc(2026, 9, 25))]: 0.0023 },
  archiveSpan: { from: D1, to: D2 },
  ...overrides,
});

describe("archiveFromReport", () => {
  const archive = archiveFromReport(file());
  const [weth, base] = archive.pools;

  it("turns report rows into archived analytics days marked as from the report", () => {
    expect(weth).toMatchObject({ id: "0xca6e", chain: "polygon", name: "TEL/WETH", archived: true, protocol: "balancer" });
    expect(weth.days[0]).toMatchObject({ day: D1, tvlUSD: 1000, volumeUSD: 50, feesUSD: 0.1, svlUSD: 900, status: "LIVE", estimated: false, source: "report" });
  });

  it("gives APR in percent and works rewards back from the incentives APR, in TEL at the reported price", () => {
    expect(weth.days[0].apr).toBeCloseTo(36.5);
    // 0.365 × 900 / 365 = 0.9 USD a day; at 0.004 USD per TEL that is 225 TEL.
    expect(weth.days[0].dailyRewardsUSD).toBeCloseTo(0.9);
    expect(weth.days[0].dailyRewardsTEL).toBeCloseTo(225);
  });

  it("keeps missing cells null, never 0, and leaves a day without incentives without a status", () => {
    expect(weth.days[1]).toMatchObject({ tvlUSD: 1100, svlUSD: null, apr: null, dailyRewardsUSD: null, dailyRewardsTEL: null, status: null });
    // D2 has no TEL price, so its rewards have no TEL figure even where they have a USD one.
    expect(base.days[0].dailyRewardsUSD).toBeCloseTo(1);
    expect(base.days[0].dailyRewardsTEL).toBeNull();
  });

  it("uses a stable report id for a pool the report doesn't tie to one address", () => {
    expect(base.id).toBe("report:uniswap-v4-2025-base-tel-eth");
    expect(archivePoolId({ key: "k", address: "0xABC" })).toBe("0xabc");
  });

  it("reads TEL prices from the program rows, skipping missing ones", () => {
    expect(archive.telUSD).toEqual({ [String(D1)]: 0.004 });
  });
});

describe("withArchive", () => {
  const archive = archiveFromReport(file());
  const recent = { id: "0xa22a", chain: "polygon" as const, name: "WETH/TEL", days: [liveDay(utc(2026, 9, 25), { tvlUSD: 92_000 })] };

  it("returns the live analytics unchanged, apart from an empty report span, without an archive", () => {
    const merged = withArchive(live([recent]), null);
    expect(merged.pools).toEqual([recent]);
    expect(merged.report).toBeNull();
  });

  it("lists archived pools after the live ones and starts the history at the report's first day", () => {
    const merged = withArchive(live([recent]), archive);
    expect(merged.pools.map(pool => pool.id)).toEqual(["0xa22a", "0xca6e", "report:uniswap-v4-2025-base-tel-eth"]);
    expect(merged.historyFrom).toBe(D1);
    expect(merged.rewardsFrom).toBe(D1);
    expect(merged.report).toEqual({ from: D1, to: D2 });
  });

  it("keeps the app's own row where it and the report both have a pool and day", () => {
    const own = { id: "0xca6e", chain: "polygon" as const, name: "TEL/WETH", days: [liveDay(D2, { tvlUSD: 7777 })] };
    const merged = withArchive(live([own]), archive);
    const pool = merged.pools.find(candidate => candidate.id === "0xca6e")!;
    expect(pool.archived).toBeUndefined();
    expect(pool.days.map(day => [day.day, day.tvlUSD, day.source])).toEqual([
      [D1, 1000, "report"],
      [D2, 7777, undefined],
    ]);
  });

  it("keeps the app's own TEL price on a day both have", () => {
    const merged = withArchive(live([], { telUSD: { [String(D1)]: 0.005 } }), archive);
    expect(merged.telUSD[String(D1)]).toBe(0.005);
  });
});

describe("ranges", () => {
  const now = utc(2026, 10, 2) + 3600;

  it("starts a range the right number of whole days back, and All at the beginning", () => {
    expect(rangeStart("30d", now)).toBe(utc(2026, 9, 3));
    expect(rangeStart("1y", now)).toBe(utc(2026, 10, 2) - 364 * DAY);
    expect(rangeStart("all", now)).toBeNull();
  });

  it("needs the archive only when the range reaches the report's days", () => {
    const span = { from: D1, to: utc(2025, 10, 1) };
    expect(rangeNeedsArchive("90d", span, now)).toBe(false);
    // A year back from Oct 2 2026 starts Oct 3 2025, after this span ends; a span into October 2025 is reached.
    expect(rangeNeedsArchive("1y", span, now)).toBe(false);
    expect(rangeNeedsArchive("1y", { from: D1, to: utc(2025, 10, 20) }, now)).toBe(true);
    expect(rangeNeedsArchive("all", span, now)).toBe(true);
    expect(rangeNeedsArchive("all", null, now)).toBe(false);
    expect(rangeNeedsArchive("all", undefined, now)).toBe(false);
  });

  it("keeps each pool's days in the range, drops archived pools with none, and keeps live pools regardless", () => {
    const recent: AnalyticsPool = { id: "0xa", chain: "polygon", name: "WETH/TEL", days: [liveDay(utc(2026, 9, 1)), liveDay(utc(2026, 9, 30))] };
    const quiet: AnalyticsPool = { id: "0xb", chain: "base", name: "ETH/TEL", days: [] };
    const old: AnalyticsPool = { id: "0xc", chain: "polygon", name: "TEL/BAL", archived: true, days: [liveDay(D1)] };
    const limited = limitToRange([recent, quiet, old], "30d", now);
    expect(limited.map(pool => [pool.id, pool.days.length])).toEqual([
      ["0xa", 1],
      ["0xb", 0],
    ]);
    expect(limitToRange([recent, quiet, old], "all", now)).toHaveLength(3);
  });
});

describe("labels", () => {
  it("names archived pools with their protocol", () => {
    expect(analyticsPoolLabel({ name: "WETH/TEL", chain: "polygon" })).toBe("WETH/TEL on Polygon");
    expect(analyticsPoolLabel({ name: "TEL/WETH", chain: "polygon", archived: true, protocol: "balancer" })).toBe("TEL/WETH on Polygon (Balancer, archived)");
    expect(analyticsPoolLabel({ name: "TEL/ETH", chain: "base", archived: true, protocol: "uniswap" })).toBe("TEL/ETH on Base (Uniswap v4, 2025, archived)");
    expect(lastRecordedDay({ id: "x", chain: "base", name: "x", days: [] })).toBeNull();
  });
});

describe("summaries across both sources", () => {
  it("summarises a period of report days and a period of recorded days, and counts the report days", () => {
    const recordedDay = utc(2025, 9, 9);
    const archive = archiveFromReport(file());
    const ownPool: AnalyticsPool = { id: "0xa22a", chain: "polygon", name: "WETH/TEL", days: [liveDay(recordedDay, { tvlUSD: 2000, svlUSD: 1000, dailyRewardsUSD: 2 })] };
    const merged = withArchive(live([ownPool], { telUSD: {} }), archive);
    const totals = programTotals(merged.pools, merged.telUSD);
    expect(totals.map(day => [day.day, day.fromReport])).toEqual([
      [D1, true],
      [D2, true],
      [recordedDay, false],
    ]);
    // Weeks run Sunday to Saturday: Aug 31 to Sep 6 2025 holds the report days, Sep 7 to 13 the recorded one.
    const [recorded, reported] = summarizePeriods(reportSeries(totals, merged.telUSD), "week", utc(2026, 1, 1));
    expect(reported).toMatchObject({ start: utc(2025, 8, 31), days: 2, reportDays: 2 });
    expect(recorded).toMatchObject({ start: utc(2025, 9, 7), days: 1, reportDays: 0 });
    // D1: 1000 TVL, 900 staked; D2: 1100 + 500 TVL, 500 staked (the WETH pool's D2 has no staked figure).
    expect(reported.avgTvlUSD).toBeCloseTo(1300);
    expect(reported.volumeUSD).toBeCloseTo(120);
  });
});

describe("the committed report history file", () => {
  const history = reportHistory as unknown as ReportHistoryFile;

  it("has the fields the dashboard reads, and days in order within its span", () => {
    expect(history.poolFields).toEqual(POOL_FIELDS);
    expect(history.programFields).toEqual(PROGRAM_FIELDS);
    expect(history.from).not.toBeNull();
    for (const pool of history.pools) {
      const days = pool.days.map(row => row[0] as number);
      expect(days).toEqual([...days].sort((a, b) => a - b));
      expect(new Set(days).size).toBe(days.length);
      expect(days[0]).toBeGreaterThanOrEqual(history.from!);
      expect(days[days.length - 1]).toBeLessThanOrEqual(history.to!);
      for (const row of pool.days) for (const cell of row) expect(cell === null || Number.isFinite(cell)).toBe(true);
    }
  });

  it("gives every pool a unique id and a known chain", () => {
    const ids = history.pools.map(archivePoolId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pool of history.pools) expect(["polygon", "base", "ethereum"]).toContain(pool.chain);
  });

  it("converts into archived pools", () => {
    const archive = archiveFromReport(history);
    expect(archive.pools.length).toBe(history.pools.length);
    expect(archive.pools.every(pool => pool.archived && pool.days.every(day => day.source === "report"))).toBe(true);
  });
});
