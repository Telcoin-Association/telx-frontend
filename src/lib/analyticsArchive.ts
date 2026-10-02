import { chainDisplayName } from "./poolTitle";
import { poolKey, type AnalyticsDay, type AnalyticsPool, type AnalyticsResponse } from "./analytics";

/*
 * The TELx daily report's history, from before the app recorded its own: the pools and program figures the team
 * reported each day, converted from the report workbook by scripts/import-report-history.py into
 * src/data/report-history.json and served by /api/analytics/archive.
 *
 * Report days become ordinary analytics days marked `source: "report"`:
 * - TVL, volume and fees are the report's;
 * - SVL is the report's staked liquidity (staked LPTs, or subscribed positions for the 2025 Uniswap pools);
 * - APR is the report's incentives APR, in percent like Merkl's;
 * - rewards per day are the incentives APR × staked liquidity / 365, the report's own definition run backwards,
 *   and in TEL at that day's reported TEL price.
 * Where the app has its own row for a pool and day, that row is kept and the report's is ignored.
 */

const DAYS_PER_YEAR = 365;
const DAY_SECONDS = 86_400;

/** One row of the report file: the UTC day start (unix seconds), then the figures in the file's field order. */
type ReportRow = Array<number | null>;

/** The report history file as scripts/import-report-history.py writes it. */
export type ReportHistoryFile = {
  source: string;
  from: number | null;
  to: number | null;
  poolFields: string[];
  programFields: string[];
  pools: Array<{
    key: string;
    name: string;
    label: string;
    chain: AnalyticsPool["chain"];
    protocol: string;
    /** The pool's address or v4 id when the report's name matches one pool in pool.json; null when it is ambiguous. */
    address: string | null;
    candidates?: string[];
    days: ReportRow[];
  }>;
  program: ReportRow[];
};

/** The report history as analytics pools, with TEL's reported price per day. */
export type AnalyticsArchive = {
  from: number | null;
  to: number | null;
  pools: AnalyticsPool[];
  telUSD: Record<string, number>;
};

/** A field of a report row by name, or null when the file has no such field or the cell is empty. */
function reader(fields: readonly string[]) {
  const index = new Map(fields.map((field, i) => [field, i]));
  return (row: ReportRow, field: string): number | null => {
    const i = index.get(field);
    const value = i === undefined ? null : row[i];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
}

/** The pool's id in the analytics: its address when the report names one pool, otherwise a stable report id. */
export const archivePoolId = (pool: Pick<ReportHistoryFile["pools"][number], "key" | "address">) => pool.address?.toLowerCase() ?? `report:${pool.key}`;

export function archiveFromReport(file: ReportHistoryFile): AnalyticsArchive {
  const programField = reader(file.programFields);
  const telUSD: Record<string, number> = {};
  for (const row of file.program) {
    const day = row[0];
    const price = programField(row, "telUSD");
    if (typeof day === "number" && price !== null && price > 0) telUSD[String(day)] = price;
  }

  const field = reader(file.poolFields);
  const pools = file.pools.map(
    (pool): AnalyticsPool => ({
      id: archivePoolId(pool),
      chain: pool.chain,
      name: pool.name,
      archived: true,
      protocol: pool.protocol,
      days: pool.days
        .filter(row => typeof row[0] === "number")
        .map((row): AnalyticsDay => {
          const day = row[0] as number;
          const staked = field(row, "stakedUSD");
          const incentivesApr = field(row, "incentivesApr");
          const rewardsUSD = incentivesApr !== null && staked !== null ? (incentivesApr * staked) / DAYS_PER_YEAR : null;
          const price = telUSD[String(day)];
          return {
            day,
            tvlUSD: field(row, "tvlUSD"),
            volumeUSD: field(row, "volumeUSD"),
            feesUSD: field(row, "feesUSD"),
            svlUSD: staked,
            apr: incentivesApr === null ? null : incentivesApr * 100,
            dailyRewardsUSD: rewardsUSD,
            dailyRewardsTEL: rewardsUSD !== null && price !== undefined ? rewardsUSD / price : null,
            status: incentivesApr !== null && incentivesApr > 0 ? "LIVE" : null,
            estimated: false,
            source: "report",
          };
        }),
    }),
  );
  return { from: file.from, to: file.to, pools, telUSD };
}

/** The live analytics with the report history added: the report's span, and where the app's own history starts. */
export type MergedAnalytics = AnalyticsResponse & { report: { from: number | null; to: number | null } | null };

const minDay = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

/**
 * `live` with `archive` added. An archived pool that is also a live pool (same chain and id) gets the report's days
 * only where the app has no row of its own; other archived pools are listed after the live ones. TEL prices follow
 * the same rule: the app's own price wins on a day both have.
 */
export function withArchive(live: AnalyticsResponse, archive: AnalyticsArchive | null): MergedAnalytics {
  if (!archive) return { ...live, report: null };
  const liveKeys = new Map(live.pools.map(pool => [poolKey(pool), pool]));
  const merged = new Map(live.pools.map(pool => [poolKey(pool), pool]));
  const extra: AnalyticsPool[] = [];
  for (const pool of archive.pools) {
    const own = liveKeys.get(poolKey(pool));
    if (!own) {
      extra.push(pool);
      continue;
    }
    const recorded = new Set(own.days.map(day => day.day));
    merged.set(poolKey(pool), {
      ...own,
      days: [...own.days, ...pool.days.filter(day => !recorded.has(day.day))].sort((a, b) => a.day - b.day),
    });
  }
  const pools = [...merged.values(), ...extra];
  const firstReportRewards = archive.pools.flatMap(pool => pool.days.filter(day => day.svlUSD !== null).map(day => day.day));
  return {
    ...live,
    historyFrom: minDay(live.historyFrom, archive.from),
    rewardsFrom: minDay(live.rewardsFrom, firstReportRewards.length ? Math.min(...firstReportRewards) : null),
    pools,
    telUSD: { ...archive.telUSD, ...live.telUSD },
    report: { from: archive.from, to: archive.to },
  };
}

/** The date ranges the dashboard offers. */
export const ANALYTICS_RANGES = ["30d", "90d", "1y", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const RANGE_LABELS: Record<AnalyticsRange, string> = { "30d": "30 days", "90d": "90 days", "1y": "1 year", all: "All" };

const RANGE_DAYS: Record<Exclude<AnalyticsRange, "all">, number> = { "30d": 30, "90d": 90, "1y": 365 };

/** The first UTC day (unix seconds) a range covers at `now`, or null for the whole history. */
export function rangeStart(range: AnalyticsRange, now: number): number | null {
  if (range === "all") return null;
  const today = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
  return today - (RANGE_DAYS[range] - 1) * DAY_SECONDS;
}

/** Whether a range reaches the days the report history covers, so it is needed to fill the range. */
export function rangeNeedsArchive(range: AnalyticsRange, span: AnalyticsResponse["archiveSpan"], now: number): boolean {
  if (!span || span.from === null || span.to === null) return false;
  const start = rangeStart(range, now);
  return start === null || start <= span.to;
}

/**
 * Each pool's days within the range. Live pools are kept even when the range holds none of their days; archived
 * pools without a day in the range are left out.
 */
export function limitToRange(pools: readonly AnalyticsPool[], range: AnalyticsRange, now: number): AnalyticsPool[] {
  const start = rangeStart(range, now);
  if (start === null) return [...pools];
  return pools
    .map(pool => ({ ...pool, days: pool.days.filter(day => day.day >= start) }))
    .filter(pool => !pool.archived || pool.days.length > 0);
}

const PROTOCOL_TITLES: Record<string, string> = { balancer: "Balancer", uniswap: "Uniswap v4, 2025" };

/** "WETH/TEL on Polygon", or "TEL/WETH on Polygon (Balancer, archived)" for a pool known only from the report. */
export function analyticsPoolLabel(pool: Pick<AnalyticsPool, "name" | "chain" | "archived" | "protocol">): string {
  const base = `${pool.name} on ${chainDisplayName(pool.chain)}`;
  if (!pool.archived) return base;
  const protocol = pool.protocol ? PROTOCOL_TITLES[pool.protocol] ?? pool.protocol : null;
  return `${base} (${protocol ? `${protocol}, ` : ""}archived)`;
}

/** The latest day a pool recorded, unix seconds, or null when it has none. */
export const lastRecordedDay = (pool: AnalyticsPool) => (pool.days.length ? pool.days[pool.days.length - 1].day : null);
