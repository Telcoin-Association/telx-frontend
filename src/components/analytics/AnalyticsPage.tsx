"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartAxisDate, formatChartAxisUSD, formatChartDate, formatChartUSD } from "@/components/chart/chartFormat";
import { chainDisplayName } from "@/lib/poolTitle";
import {
  downloadCsv,
  filterAnalyticsPools,
  isoDay,
  poolKey,
  poolRewardsNow,
  poolRewardsSeries,
  programTotals,
  toCsv,
  type AnalyticsCampaign,
  type AnalyticsFilter,
  type AnalyticsResponse,
  type CsvColumn,
} from "@/lib/analytics";

const CHAINS: AnalyticsFilter["chain"][] = ["all", "polygon", "base", "ethereum"];
const CHIP = "cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200";
const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const tel = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });
const formatPercent = (value: number | null | undefined) => (value === null || value === undefined ? "Unavailable" : percent.format(value));
const formatApr = (value: number | null | undefined) => (value === null || value === undefined ? "Unavailable" : percent.format(value / 100));
const formatTelAmount = (value: number | null | undefined) => (value === null || value === undefined ? "Unavailable" : tel.format(value));
const formatWindow = (start: number | null, end: number | null) =>
  start === null && end === null ? "Unknown" : `${start === null ? "?" : formatChartDate(new Date(start).toISOString().slice(0, 10))} to ${end === null ? "?" : formatChartDate(new Date(end).toISOString().slice(0, 10))}`;

type Series<T> = { key: keyof T & string; label: string; color: string; format: (value: number | null) => string };

/** A line chart with a text alternative, the latest figures as text, and a CSV download of the plotted series. */
function SeriesChart<T extends { day: number }>({ title, rows, series, filename }: { title: string; rows: readonly T[]; series: Series<T>[]; filename: string }) {
  const captionId = useId();
  const points = rows.map(row => ({ ...row, date: isoDay(row.day) }));
  const latest = [...rows].reverse().find(row => series.some(item => typeof row[item.key] === "number"));
  const summary = latest
    ? `${title}, ${formatChartDate(isoDay(latest.day))}: ${series.map(item => `${item.label} ${item.format((latest[item.key] as number | null) ?? null)}`).join(", ")}.`
    : `${title}: nothing recorded yet.`;
  const columns: CsvColumn<T>[] = [{ header: "date", value: row => isoDay(row.day) }, ...series.map(item => ({ header: item.label, value: (row: T) => (row[item.key] as number | null) ?? null }))];

  return (
    <figure aria-labelledby={captionId} className="flex flex-col gap-2 rounded-2xl bg-black/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <figcaption id={captionId} className="text-sm text-white">
          {title}
        </figcaption>
        <button type="button" onClick={() => downloadCsv(filename, toCsv(columns, rows))} className={`${CHIP} ${CHIP_IDLE}`}>
          CSV
        </button>
      </div>
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatChartAxisDate} stroke="currentColor" fontSize={11} />
            <YAxis tickFormatter={value => series[0].format(Number(value))} stroke="currentColor" fontSize={11} width={64} />
            <Tooltip
              labelFormatter={label => formatChartDate(String(label))}
              formatter={(value, name) => {
                const item = series.find(entry => entry.key === name);
                return [item ? item.format(Number(value)) : String(value), item?.label ?? String(name)];
              }}
            />
            {series.map(item => (
              <Line key={item.key} type="monotone" dataKey={item.key} name={item.key} stroke={item.color} dot={false} strokeWidth={2} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-primary">{summary}</p>
    </figure>
  );
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; data: AnalyticsResponse };

/** The public analytics dashboard: program totals over time, each pool's rewards efficiency, and the campaigns. */
export default function AnalyticsPage() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [filter, setFilter] = useState<AnalyticsFilter>({ chain: "all", pool: null });

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

  const data = load.state === "ready" ? load.data : null;
  const pools = useMemo(() => (data ? filterAnalyticsPools(data.pools, filter) : []), [data, filter]);
  const totals = useMemo(() => (data ? programTotals(pools, data.telUSD) : []), [data, pools]);
  const campaigns = useMemo(
    () => (data ? data.campaigns.filter(c => (filter.chain === "all" || c.chain === filter.chain) && (filter.pool === null || `${c.chain}:${c.poolId}` === filter.pool)) : []),
    [data, filter],
  );

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
          <p className="text-xs text-primary">
            History starts {formatChartDate(isoDay(data.historyFrom))}. Earlier days weren&apos;t recorded.{" "}
            {data.rewardsFrom === null
              ? "APR, SVL and rewards history starts once the first daily Merkl rows are recorded."
              : `APR, SVL and rewards history starts ${formatChartDate(isoDay(data.rewardsFrom))}.`}
          </p>

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
            <label className="flex items-center gap-2 text-xs text-primary">
              Pool
              <select
                value={filter.pool ?? ""}
                onChange={event => setFilter(current => ({ ...current, pool: event.target.value || null }))}
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-xs text-white"
              >
                <option value="">All pools</option>
                {data.pools
                  .filter(pool => filter.chain === "all" || pool.chain === filter.chain)
                  .map(pool => (
                    <option key={poolKey(pool)} value={poolKey(pool)}>
                      {pool.name} on {chainDisplayName(pool.chain)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

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
                    const now = poolRewardsNow(pool);
                    return (
                      <tr key={poolKey(pool)} className="border-t border-white/10">
                        <td className="px-4 py-3">{pool.name}</td>
                        <td className="px-4 py-3">{chainDisplayName(pool.chain)}</td>
                        {now.state === "live" ? (
                          <>
                            <td className="px-4 py-3 text-right">{formatApr(now.figures.apr)}</td>
                            <td className="px-4 py-3 text-right">{formatPercent(now.figures.subscribedShare)}</td>
                            <td className="px-4 py-3 text-right">
                              {now.figures.costPer1kSvlWeekUSD !== null ? formatChartUSD(now.figures.costPer1kSvlWeekUSD) : "Unavailable"}
                            </td>
                          </>
                        ) : (
                          <td colSpan={3} className="px-4 py-3 text-right text-primary">
                            {now.state === "unrecorded" ? "Not recorded yet" : "No live campaign"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pools.length === 1 && poolRewardsNow(pools[0]).state === "unrecorded" ? (
              <p className="text-xs text-primary">{pools[0].name}&apos;s APR and rewards history starts once its first daily Merkl row is recorded.</p>
            ) : pools.length === 1 ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <SeriesChart
                  title={`${pools[0].name} APR`}
                  rows={poolRewardsSeries(pools[0])}
                  filename={`telx-${pools[0].chain}-${pools[0].name.replace("/", "-")}-apr.csv`}
                  series={[{ key: "apr", label: "APR", color: "var(--color-accent, #4967ff)", format: value => formatApr(value) }]}
                />
                <SeriesChart
                  title={`${pools[0].name} rewards efficiency`}
                  rows={poolRewardsSeries(pools[0])}
                  filename={`telx-${pools[0].chain}-${pools[0].name.replace("/", "-")}-efficiency.csv`}
                  series={[
                    { key: "costPer1kSvlWeekUSD", label: "Rewards per $1k SVL per week", color: "#ffffff", format: formatChartUSD },
                    { key: "subscribedShare", label: "Subscribed share of TVL", color: "#a3a3a3", format: formatPercent },
                  ]}
                />
              </div>
            ) : (
              <p className="text-xs text-primary">Choose a pool above to chart its APR and rewards efficiency.</p>
            )}
          </section>

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
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs text-primary">
                    <tr>
                      <th className="px-4 py-3 font-normal">Pool</th>
                      <th className="px-4 py-3 font-normal">Campaign</th>
                      <th className="px-4 py-3 font-normal">Window (UTC)</th>
                      <th className="px-4 py-3 text-right font-normal">Daily budget</th>
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
                        </td>
                        <td className="px-4 py-3">{formatWindow(campaign.start, campaign.end)}</td>
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
  { header: "daily budget usd", value: c => c.dailyBudgetUSD },
  { header: "apr min", value: c => c.aprMin },
  { header: "apr max", value: c => c.aprMax },
  { header: "peak svl usd", value: c => c.peakSvlUSD },
];
