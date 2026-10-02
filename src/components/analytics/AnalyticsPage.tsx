"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatChartDate, formatChartUSD } from "@/components/chart/chartFormat";
import { chainDisplayName } from "@/lib/poolTitle";
import {
  downloadCsv,
  filterAnalyticsPools,
  isoDay,
  poolKey,
  poolRewardsNow,
  poolRewardsSeries,
  programTotals,
  svlExceedsTvl,
  toCsv,
  type AnalyticsCampaign,
  type AnalyticsFilter,
  type AnalyticsResponse,
  type CsvColumn,
} from "@/lib/analytics";
import {
  ANALYTICS_RANGES,
  analyticsPoolLabel,
  archiveFromReport,
  lastRecordedDay,
  limitToRange,
  RANGE_LABELS,
  rangeNeedsArchive,
  withArchive,
  type AnalyticsArchive,
  type AnalyticsRange,
  type ReportHistoryFile,
} from "@/lib/analyticsArchive";
import { poolComparison, poolReportSeries, reportSeries, type ComparisonMetric, type ComparisonRow } from "@/lib/analyticsReports";
import AnalyticsReports from "./AnalyticsReports";
import { CHIP, CHIP_ACTIVE, CHIP_IDLE, SERIES_COLORS, SeriesChart, type Series } from "./SeriesChart";

export { SeriesTooltipContent } from "./SeriesChart";

const CHAINS: AnalyticsFilter["chain"][] = ["all", "polygon", "base", "ethereum"];

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const tel = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });
const telPrice = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 3 });
const formatPercent = (value: number | null | undefined) => (value === null || value === undefined ? "Unavailable" : percent.format(value));
const formatApr = (value: number | null | undefined) => (value === null || value === undefined ? "Unavailable" : percent.format(value / 100));
const formatTelAmount = (value: number | null | undefined) => (value === null || value === undefined ? "Unavailable" : tel.format(value));
const formatTelPrice = (value: number | null) => (value === null ? "Unavailable" : telPrice.format(value));
const formatWindow = (start: number | null, end: number | null) =>
  start === null && end === null ? "Unknown" : `${start === null ? "?" : formatChartDate(new Date(start).toISOString().slice(0, 10))} to ${end === null ? "?" : formatChartDate(new Date(end).toISOString().slice(0, 10))}`;

/** The dashboard's tabs, in order; each also answers to its id as the URL hash. */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "pools", label: "Pools" },
  { id: "campaigns", label: "Campaigns" },
  { id: "reports", label: "Reports" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const isTab = (value: string): value is TabId => TABS.some(tab => tab.id === value);

const COMPARISONS: Array<{ metric: ComparisonMetric; title: string; slug: string; format: (value: number | null) => string }> = [
  { metric: "svlUSD", title: "Subscribed Value Locked by pool", slug: "svl", format: formatChartUSD },
  { metric: "volumeUSD", title: "Volume per day by pool", slug: "volume", format: formatChartUSD },
  { metric: "totalApr", title: "Total APR by pool", slug: "total-apr", format: formatPercent },
];

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; data: AnalyticsResponse };

/** The report history: not needed yet, loading, failed, or loaded. */
type ArchiveLoad = { state: "idle" } | { state: "loading" } | { state: "error" } | { state: "ready"; archive: AnalyticsArchive };

/**
 * Tabs that follow the WAI-ARIA tabs pattern: arrow keys, Home and End move between them, and the chosen tab is
 * kept in the URL hash so a link can open it.
 */
function useTabs() {
  const [tab, setTab] = useState<TabId>("overview");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (isTab(fromHash)) setTab(fromHash);
  }, []);

  const choose = useCallback((next: TabId, focus = false) => {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
    if (focus) refs.current[next]?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex(item => item.id === tab);
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    choose(TABS[target].id, true);
  };

  return { tab, choose, onKeyDown, refs };
}

/**
 * The public analytics dashboard, in tabs: the program over time, the pools compared, the campaigns, and period
 * summaries in the layout of the TELx daily report. The chain and pool filters apply to every tab.
 */
export default function AnalyticsPage() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [filter, setFilter] = useState<AnalyticsFilter>({ chain: "all", pool: null });
  const [range, setRange] = useState<AnalyticsRange>("90d");
  const [archiveLoad, setArchiveLoad] = useState<ArchiveLoad>({ state: "idle" });
  const { tab, choose, onKeyDown, refs } = useTabs();
  const now = useMemo(() => Math.floor(Date.now() / 1000), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analytics")
      .then(async res => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as AnalyticsResponse;
      })
      .then(data => !cancelled && setLoad({ state: "ready", data }))
      .catch(() => !cancelled && setLoad({ state: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const live = load.state === "ready" ? load.data : null;
  const needsArchive = live !== null && rangeNeedsArchive(range, live.archiveSpan, now);

  // The report history is fetched once, the first time a range reaches the days it covers.
  useEffect(() => {
    if (!needsArchive || archiveLoad.state !== "idle") return;
    setArchiveLoad({ state: "loading" });
    fetch("/api/analytics/archive")
      .then(async res => {
        if (!res.ok) throw new Error(String(res.status));
        return archiveFromReport((await res.json()) as ReportHistoryFile);
      })
      .then(archive => setArchiveLoad({ state: "ready", archive }))
      .catch(() => setArchiveLoad({ state: "error" }));
  }, [needsArchive, archiveLoad.state]);

  const data = useMemo(() => (live ? withArchive(live, archiveLoad.state === "ready" ? archiveLoad.archive : null) : null), [live, archiveLoad]);
  const pools = useMemo(() => (data ? limitToRange(filterAnalyticsPools(data.pools, filter), range, now) : []), [data, filter, range, now]);
  const totals = useMemo(() => (data ? programTotals(pools, data.telUSD) : []), [data, pools]);
  const report = useMemo(() => (data ? reportSeries(totals, data.telUSD) : []), [data, totals]);
  const estimated = useMemo(() => pools.some(pool => pool.days.some(day => day.estimated)), [pools]);
  const capped = useMemo(() => svlExceedsTvl(pools), [pools]);
  const hasTelPrice = useMemo(() => report.some(day => day.telUSD !== null), [report]);
  const campaigns = useMemo(
    () => (data ? data.campaigns.filter(c => (filter.chain === "all" || c.chain === filter.chain) && (filter.pool === null || `${c.chain}:${c.poolId}` === filter.pool)) : []),
    [data, filter],
  );
  const comparisons = useMemo(
    () =>
      data && pools.length > 1
        ? COMPARISONS.map(comparison => ({
            ...comparison,
            rows: poolComparison(pools, data.telUSD, comparison.metric),
            series: pools.map(
              (pool, i): Series<ComparisonRow> => ({
                key: poolKey(pool),
                label: analyticsPoolLabel(pool),
                color: SERIES_COLORS[i % SERIES_COLORS.length],
                format: comparison.format,
              }),
            ),
          }))
        : [],
    [data, pools],
  );
  const single = pools.length === 1 ? pools[0] : null;
  const singleSlug = single ? `${single.chain}-${single.name.replace("/", "-")}` : "";

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-20 text-white">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl">Analytics</h1>
        <p className="text-sm text-primary">TELx liquidity, volume, fees and rewards over time, from on-chain data and Merkl.</p>
      </header>

      {load.state === "loading" && <p className="text-sm text-primary">Loading analytics…</p>}
      {load.state === "error" && <p className="text-sm text-yellow-400">Analytics are unavailable right now. Try again later.</p>}
      {data && data.historyFrom === null && <p className="text-sm text-primary">History starts once the first daily rows are recorded.</p>}

      {data && data.historyFrom !== null && (
        <>
          {data.report && data.report.from !== null && data.report.to !== null && live?.historyFrom != null ? (
            <p className="text-xs text-primary">
              Days from {formatChartDate(isoDay(data.report.from))} to {formatChartDate(isoDay(data.report.to))} are from the TELx daily report, the
              figures the team reported each day. From {formatChartDate(isoDay(live.historyFrom))} they are recorded from on-chain data and Merkl.
              Days between weren&apos;t recorded, and where both have a day, the recorded figures are shown.
            </p>
          ) : (
            <p className="text-xs text-primary">
              History starts {formatChartDate(isoDay(data.historyFrom))}.{" "}
              {data.rewardsFrom === null
                ? "APR, SVL and rewards history starts once the first daily Merkl rows are recorded."
                : `APR, SVL and rewards history starts ${formatChartDate(isoDay(data.rewardsFrom))}.`}{" "}
              {live?.archiveSpan?.from != null && <>Choose All for the TELx daily report&apos;s history from {formatChartDate(isoDay(live.archiveSpan.from))}.</>}
            </p>
          )}
          {archiveLoad.state === "loading" && <p className="text-xs text-primary">Loading the TELx daily report&apos;s history…</p>}
          {archiveLoad.state === "error" && (
            <p className="text-xs text-yellow-400">The TELx daily report&apos;s history couldn&apos;t be loaded, so only the recorded history is shown.</p>
          )}
          {estimated && (
            <p className="text-xs text-primary">
              Rewards, SVL and APR for days before Merkl&apos;s own daily figures were recorded are our estimates, from each campaign&apos;s
              funding and the positions subscribed on chain. They can differ from Merkl&apos;s figures by a few percent.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filter by chain" className="flex flex-wrap gap-2">
              {CHAINS.map(chain => (
                <button
                  key={chain}
                  type="button"
                  aria-pressed={filter.chain === chain}
                  onClick={() => setFilter({ chain, pool: null })}
                  className={`${CHIP} ${filter.chain === chain ? CHIP_ACTIVE : CHIP_IDLE}`}
                >
                  {chain === "all" ? "All chains" : chainDisplayName(chain)}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Date range" className="flex flex-wrap gap-2">
              {ANALYTICS_RANGES.map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={range === option}
                  onClick={() => setRange(option)}
                  className={`${CHIP} ${range === option ? CHIP_ACTIVE : CHIP_IDLE}`}
                >
                  {RANGE_LABELS[option]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-primary">
              Pool
              <select
                value={filter.pool ?? ""}
                onChange={event => {
                  const pool = event.target.value || null;
                  setFilter(current => ({ ...current, pool }));
                  // An archived pool has no days in the recent ranges, so choosing one shows the whole history.
                  if (pool && data.pools.some(candidate => candidate.archived && poolKey(candidate) === pool)) setRange("all");
                }}
                className="select-chevron rounded-lg border border-white/10 bg-black/40 py-2 pl-3 text-xs text-white transition-colors hover:border-accent-light/60"
              >
                <option value="">All pools</option>
                {data.pools
                  .filter(pool => !pool.archived && (filter.chain === "all" || pool.chain === filter.chain))
                  .map(pool => (
                    <option key={poolKey(pool)} value={poolKey(pool)}>
                      {analyticsPoolLabel(pool)}
                    </option>
                  ))}
                {data.pools.some(pool => pool.archived && (filter.chain === "all" || pool.chain === filter.chain)) && (
                  <optgroup label="Archived pools, from the TELx daily report">
                    {data.pools
                      .filter(pool => pool.archived && (filter.chain === "all" || pool.chain === filter.chain))
                      .map(pool => (
                        <option key={poolKey(pool)} value={poolKey(pool)}>
                          {analyticsPoolLabel(pool)}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </label>
          </div>

          <div role="tablist" aria-label="Analytics sections" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto rounded-xl bg-black/20 p-1">
            {TABS.map(item => (
              <button
                key={item.id}
                ref={element => {
                  refs.current[item.id] = element;
                }}
                type="button"
                role="tab"
                id={`analytics-tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`analytics-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => choose(item.id)}
                className={`shrink-0 cursor-pointer rounded-lg px-4 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                  tab === item.id ? "bg-accent font-bold text-white" : "text-primary hover:bg-navy/50 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`analytics-panel-${tab}`} aria-labelledby={`analytics-tab-${tab}`} className="flex flex-col gap-6">
            {tab === "overview" && (
              <>
                <section aria-label="Program totals" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SeriesChart
                    title="TVL and Subscribed Value Locked"
                    rows={totals}
                    filename="telx-tvl-svl.csv"
                    series={[
                      { key: "tvlUSD", label: "TVL", color: "#ffffff", format: formatChartUSD },
                      { key: "svlUSD", label: "SVL", color: "var(--color-accent, #4967ff)", format: formatChartUSD },
                    ]}
                  />
                  <SeriesChart
                    title="Volume and fees per day"
                    rows={totals}
                    filename="telx-volume-fees.csv"
                    series={[
                      { key: "volumeUSD", label: "Volume", color: "#ffffff", format: formatChartUSD },
                      { key: "feesUSD", label: "Fees", color: "#a3a3a3", format: formatChartUSD },
                    ]}
                  />
                  <SeriesChart
                    title="TEL distributed per day"
                    rows={totals}
                    filename="telx-tel-distributed.csv"
                    series={[
                      { key: "telDistributed", label: "TEL", color: "var(--color-accent, #4967ff)", format: formatTelAmount },
                      { key: "rewardsUSD", label: "USD value", color: "#a3a3a3", format: formatChartUSD },
                    ]}
                  />
                </section>
                <section aria-label="Returns and participation" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SeriesChart
                    title="APR: incentives, fees and total"
                    rows={report}
                    filename="telx-apr-breakdown.csv"
                    series={[
                      { key: "totalApr", label: "Total APR", color: "#ffffff", format: formatPercent },
                      { key: "incentivesApr", label: "Incentives APR", color: "#8a9dff", format: formatPercent },
                      { key: "feesApr", label: "Fees APR", color: "#a3a3a3", format: formatPercent },
                    ]}
                  />
                  <SeriesChart
                    title="Subscribed share of TVL"
                    rows={report}
                    filename="telx-subscribed-share.csv"
                    series={[{ key: "subscribedShare", label: "Subscribed share", color: "#8a9dff", format: formatPercent }]}
                  />
                  <SeriesChart
                    title="Cumulative volume and fees"
                    rows={report}
                    filename="telx-cumulative-volume-fees.csv"
                    series={[
                      { key: "cumulativeVolumeUSD", label: "Volume", color: "#ffffff", format: formatChartUSD },
                      { key: "cumulativeFeesUSD", label: "Fees", color: "#a3a3a3", format: formatChartUSD },
                    ]}
                  />
                  {hasTelPrice ? (
                    <SeriesChart
                      title="TEL price"
                      rows={report}
                      filename="telx-tel-price.csv"
                      series={[{ key: "telUSD", label: "TEL", color: "#37aeff", format: formatTelPrice }]}
                    />
                  ) : (
                    <figure className="flex min-w-0 flex-col gap-2 rounded-2xl bg-black/20 p-4">
                      <figcaption className="text-sm text-white">TEL price</figcaption>
                      <p className="text-xs text-primary">The TEL price history starts once daily pool prices are recorded.</p>
                    </figure>
                  )}
                </section>
                <p className="text-xs text-primary">
                  Incentives APR is rewards over SVL and fees APR is fees over TVL, both annualised, as in the TELx daily report. Total APR adds
                  them. The TEL price is the average closing price of the TEL pools.
                  {capped && " On some days SVL reads above TVL, because the two are measured at different moments; the subscribed share is shown as 100% then."}
                </p>
              </>
            )}

            {tab === "pools" && (
              <section aria-label="Pools" className="flex flex-col gap-3">
                <h2 className="text-xl">Pools</h2>
                <div className="overflow-x-auto rounded-2xl bg-black/20">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs text-primary">
                      <tr>
                        <th className="px-4 py-3 font-normal">Pool</th>
                        <th className="px-4 py-3 font-normal">Chain</th>
                        <th className="px-4 py-3 text-right font-normal">APR</th>
                        <th className="px-4 py-3 text-right font-normal">Subscribed share of TVL</th>
                        <th className="px-4 py-3 text-right font-normal">Rewards per $1k SVL per week</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pools.map(pool => {
                        const latest = poolRewardsNow(pool);
                        const last = lastRecordedDay(pool);
                        return (
                          <tr key={poolKey(pool)} className="border-t border-white/10">
                            <td className="px-4 py-3">
                              {pool.name}
                              {pool.archived && <span className="block text-xs text-primary">{pool.protocol === "balancer" ? "Balancer" : "Uniswap v4, 2025"}</span>}
                            </td>
                            <td className="px-4 py-3">{chainDisplayName(pool.chain)}</td>
                            {pool.archived ? (
                              <td colSpan={3} className="px-4 py-3 text-right text-primary">
                                Archived{last !== null ? `, last reported ${formatChartDate(isoDay(last))}` : ""}
                              </td>
                            ) : latest.state === "live" ? (
                              <>
                                <td className="px-4 py-3 text-right">{formatApr(latest.figures.apr)}</td>
                                <td className="px-4 py-3 text-right">{formatPercent(latest.figures.subscribedShare)}</td>
                                <td className="px-4 py-3 text-right">
                                  {latest.figures.costPer1kSvlWeekUSD !== null ? formatChartUSD(latest.figures.costPer1kSvlWeekUSD) : "Unavailable"}
                                </td>
                              </>
                            ) : (
                              <td colSpan={3} className="px-4 py-3 text-right text-primary">
                                {latest.state === "unrecorded" ? "Not recorded yet" : "No live campaign"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-primary">
                  APR in this table is Merkl&apos;s, for the latest day with a live campaign. Archived pools are known from the TELx daily report.
                </p>

                {comparisons.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {comparisons.map(comparison => (
                      <SeriesChart
                        key={comparison.metric}
                        title={comparison.title}
                        rows={comparison.rows}
                        filename={`telx-pools-${comparison.slug}.csv`}
                        series={comparison.series}
                      />
                    ))}
                  </div>
                )}

                {single && poolRewardsNow(single).state === "unrecorded" ? (
                  <p className="text-xs text-primary">{single.name}&apos;s APR and rewards history starts once its first daily Merkl row is recorded.</p>
                ) : single ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <SeriesChart
                      title={`${single.name} APR`}
                      rows={poolRewardsSeries(single)}
                      filename={`telx-${singleSlug}-apr.csv`}
                      series={[{ key: "apr", label: "APR", color: "var(--color-accent, #4967ff)", format: value => formatApr(value) }]}
                    />
                    <SeriesChart
                      title={`${single.name} rewards efficiency`}
                      rows={poolRewardsSeries(single)}
                      filename={`telx-${singleSlug}-efficiency.csv`}
                      series={[
                        { key: "costPer1kSvlWeekUSD", label: "Rewards per $1k SVL per week", color: "#ffffff", format: formatChartUSD },
                        { key: "subscribedShare", label: "Subscribed share of TVL", color: "#a3a3a3", format: formatPercent },
                      ]}
                    />
                    <SeriesChart
                      title={`${single.name} APR: incentives, fees and total`}
                      rows={poolReportSeries(single, data.telUSD)}
                      filename={`telx-${singleSlug}-apr-breakdown.csv`}
                      series={[
                        { key: "totalApr", label: "Total APR", color: "#ffffff", format: formatPercent },
                        { key: "incentivesApr", label: "Incentives APR", color: "#8a9dff", format: formatPercent },
                        { key: "feesApr", label: "Fees APR", color: "#a3a3a3", format: formatPercent },
                      ]}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-primary">Choose a pool above to chart its APR and rewards efficiency.</p>
                )}
              </section>
            )}

            {tab === "campaigns" && (
              <section aria-label="Campaigns" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xl">Campaigns</h2>
                  <button
                    type="button"
                    onClick={() => downloadCsv("telx-campaigns.csv", toCsv(CAMPAIGN_COLUMNS, campaigns))}
                    className={`${CHIP} ${CHIP_IDLE}`}
                  >
                    CSV
                  </button>
                </div>
                {campaigns.length === 0 ? (
                  <p className="text-xs text-primary">No campaigns recorded for this selection yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-2xl bg-black/20">
                    <table className="w-full min-w-[820px] text-left text-sm">
                      <thead className="text-xs text-primary">
                        <tr>
                          <th className="px-4 py-3 font-normal">Pool</th>
                          <th className="px-4 py-3 font-normal">Campaign</th>
                          <th className="px-4 py-3 font-normal">Window (UTC)</th>
                          <th className="px-4 py-3 text-right font-normal">Daily budget (TEL)</th>
                          <th className="px-4 py-3 text-right font-normal">Daily budget (USD)</th>
                          <th className="px-4 py-3 text-right font-normal">APR range</th>
                          <th className="px-4 py-3 text-right font-normal">Peak SVL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map(campaign => (
                          <tr key={`${campaign.chain}:${campaign.poolId}:${campaign.id}`} className="border-t border-white/10">
                            <td className="px-4 py-3">
                              {campaign.poolName} on {chainDisplayName(campaign.chain)}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs" title={campaign.id}>
                              {campaign.id.slice(0, 10)}…
                              {campaign.estimated && <span className="ml-2 font-sans text-primary">Estimated</span>}
                            </td>
                            <td className="px-4 py-3">{formatWindow(campaign.start, campaign.end)}</td>
                            <td className="px-4 py-3 text-right">{campaign.dailyBudgetTEL !== null ? `${tel.format(campaign.dailyBudgetTEL)} TEL` : "Unavailable"}</td>
                            <td className="px-4 py-3 text-right">{campaign.dailyBudgetUSD !== null ? formatChartUSD(campaign.dailyBudgetUSD) : "Unavailable"}</td>
                            <td className="px-4 py-3 text-right">
                              {campaign.aprMin === null ? "Unavailable" : `${formatApr(campaign.aprMin)} to ${formatApr(campaign.aprMax)}`}
                            </td>
                            <td className="px-4 py-3 text-right">{campaign.peakSvlUSD !== null ? formatChartUSD(campaign.peakSvlUSD) : "Unavailable"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === "reports" && <AnalyticsReports pools={pools} program={report} telUSD={data.telUSD} now={now} />}
          </div>
        </>
      )}
    </div>
  );
}

const CAMPAIGN_COLUMNS: CsvColumn<AnalyticsCampaign>[] = [
  { header: "chain", value: c => c.chain },
  { header: "pool", value: c => c.poolName },
  { header: "pool id", value: c => c.poolId },
  { header: "campaign id", value: c => c.id },
  { header: "start", value: c => (c.start === null ? null : new Date(c.start).toISOString()) },
  { header: "end", value: c => (c.end === null ? null : new Date(c.end).toISOString()) },
  { header: "daily budget tel", value: c => c.dailyBudgetTEL },
  { header: "daily budget usd", value: c => c.dailyBudgetUSD },
  { header: "apr min", value: c => c.aprMin },
  { header: "apr max", value: c => c.aprMax },
  { header: "peak svl usd", value: c => c.peakSvlUSD },
  { header: "estimated", value: c => (c.estimated ? "yes" : "no") },
];
