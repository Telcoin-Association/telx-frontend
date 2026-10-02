"use client";

import React, { useMemo, useState } from "react";
import { formatChartUSD } from "@/components/chart/chartFormat";
import { chainDisplayName } from "@/lib/poolTitle";
import { downloadCsv, isoDay, poolKey, toCsv, type AnalyticsPool, type AnalyticsResponse, type CsvColumn } from "@/lib/analytics";
import {
  periodChange,
  poolReportSeries,
  previousSummary,
  REPORT_PERIODS,
  summarizePeriods,
  type FigureChange,
  type PeriodSummary,
  type ReportDay,
  type ReportPeriod,
  type SummaryFigure,
} from "@/lib/analyticsReports";
import { CHIP, CHIP_ACTIVE, CHIP_IDLE } from "./SeriesChart";

const PERIOD_LABELS: Record<ReportPeriod, string> = { day: "Daily", week: "Weekly", month: "Monthly", quarter: "Quarterly" };

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const signedPercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const signedPoints = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const compactTel = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });

const dash = "Unavailable";
const usd = (value: number | null) => (value === null ? dash : formatChartUSD(value));
const share = (value: number | null) => (value === null ? dash : percent.format(value));
const telAmount = (value: number | null) => (value === null ? dash : `${compactTel.format(value)} TEL`);

/** The summary table's columns, in the daily report's order. */
const COLUMNS: Array<{ figure: SummaryFigure; label: string; format: (value: number | null) => string }> = [
  { figure: "avgTvlUSD", label: "Avg TVL", format: usd },
  { figure: "avgSvlUSD", label: "Avg SVL", format: usd },
  { figure: "subscribedShare", label: "Subscribed share", format: share },
  { figure: "incentivesApr", label: "Incentives APR", format: share },
  { figure: "feesApr", label: "Fees APR", format: share },
  { figure: "totalApr", label: "Total APR", format: share },
  { figure: "volumeUSD", label: "Volume", format: usd },
  { figure: "feesUSD", label: "Fees", format: usd },
  { figure: "telDistributed", label: "TEL distributed", format: telAmount },
];

/** "+12.3%" for an amount, "+2.1 pts" for a share or APR. */
export function formatChange(change: FigureChange | null): string {
  if (change === null) return dash;
  return change.kind === "points" ? `${signedPoints.format(change.value * 100)} pts` : signedPercent.format(change.value);
}

type ScopeSeries = { scope: string; series: ReportDay[] };

/**
 * Period summaries in the daily report's layout: one row per chosen pool for the chosen period, the chosen pools
 * together, the previous period, and the change between them. The CSV holds every period at the chosen granularity.
 */
export default function AnalyticsReports({
  pools,
  program,
  telUSD,
  now,
}: {
  pools: readonly AnalyticsPool[];
  program: readonly ReportDay[];
  telUSD: AnalyticsResponse["telUSD"];
  /** Unix seconds: periods that end after it are still running. */
  now: number;
}) {
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [chosenStart, setChosenStart] = useState<number | null>(null);

  const perPool = useMemo<ScopeSeries[]>(
    () => pools.map(pool => ({ scope: `${pool.name} on ${chainDisplayName(pool.chain)}`, series: poolReportSeries(pool, telUSD) })),
    [pools, telUSD],
  );
  const summaries = useMemo(() => summarizePeriods(program, period, now), [program, period, now]);
  const current = summaries.find(summary => summary.start === chosenStart) ?? summaries[0] ?? null;
  const previous = current ? previousSummary(summaries, current, period) : null;
  const change = current && previous ? periodChange(current, previous) : null;

  const exportCsv = () => {
    const scopes: ScopeSeries[] = [{ scope: "Selected pools", series: [...program] }, ...perPool];
    const rows = scopes.flatMap(({ scope, series }) => summarizePeriods(series, period, now).map(summary => ({ scope, summary })));
    const columns: CsvColumn<{ scope: string; summary: PeriodSummary }>[] = [
      { header: "period", value: row => row.summary.label },
      { header: "start", value: row => isoDay(row.summary.start) },
      { header: "to date", value: row => (row.summary.partial ? "yes" : "no") },
      { header: "days recorded", value: row => row.summary.days },
      { header: "scope", value: row => row.scope },
      ...COLUMNS.map(column => ({ header: column.label, value: (row: { summary: PeriodSummary }) => row.summary[column.figure] })),
    ];
    downloadCsv(`telx-${period}-summary.csv`, toCsv(columns, rows));
  };

  return (
    <section aria-label="Period summaries" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl">Period summaries</h2>
        <button type="button" onClick={exportCsv} disabled={!current} className={`${CHIP} ${CHIP_IDLE} disabled:cursor-not-allowed disabled:opacity-50`}>
          CSV
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Summary period" className="flex flex-wrap gap-2">
          {REPORT_PERIODS.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={period === option}
              onClick={() => {
                setPeriod(option);
                setChosenStart(null);
              }}
              className={`${CHIP} ${period === option ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {PERIOD_LABELS[option]}
            </button>
          ))}
        </div>
        {summaries.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-primary">
            Period
            <select
              value={current?.start ?? ""}
              onChange={event => setChosenStart(Number(event.target.value))}
              className="select-chevron rounded-lg border border-white/10 bg-black/40 py-2 pl-3 text-xs text-white transition-colors hover:border-accent-light/60"
            >
              {summaries.map(summary => (
                <option key={summary.start} value={summary.start}>
                  {summary.label}
                  {summary.partial ? " (to date)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!current ? (
        <p className="text-xs text-primary">Nothing recorded for this selection yet.</p>
      ) : (
        <>
          <p className="text-xs text-primary">
            {current.label}
            {current.partial ? ", to date" : ""}: {current.days} {current.days === 1 ? "day" : "days"} recorded. Levels and APRs are daily averages;
            volume, fees and TEL distributed are totals. Incentives APR is rewards over SVL, and fees APR is fees over TVL, both annualised.
          </p>
          <div className="overflow-x-auto rounded-2xl bg-black/20">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="text-xs text-primary">
                <tr>
                  <th className="px-4 py-3 font-normal">Pool</th>
                  {COLUMNS.map(column => (
                    <th key={column.figure} className="px-4 py-3 text-right font-normal">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perPool.map(({ scope, series }, index) => {
                  const summary = summarizePeriods(series, period, now).find(candidate => candidate.start === current.start) ?? null;
                  return (
                    <tr key={poolKey(pools[index])} className="border-t border-white/10">
                      <td className="px-4 py-3">{scope}</td>
                      {COLUMNS.map(column => (
                        <td key={column.figure} className="px-4 py-3 text-right">
                          {summary ? column.format(summary[column.figure]) : dash}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr className="border-t border-white/20 font-semibold">
                  <td className="px-4 py-3">Selected pools</td>
                  {COLUMNS.map(column => (
                    <td key={column.figure} className="px-4 py-3 text-right">
                      {column.format(current[column.figure])}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-white/10 text-primary">
                  <td className="px-4 py-3">{previous ? `Previous: ${previous.label}` : "Previous period"}</td>
                  {COLUMNS.map(column => (
                    <td key={column.figure} className="px-4 py-3 text-right">
                      {previous ? column.format(previous[column.figure]) : dash}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-4 py-3">Change</td>
                  {COLUMNS.map(column => (
                    <td key={column.figure} className="px-4 py-3 text-right">
                      {change ? formatChange(change[column.figure]) : dash}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          {current.partial && previous && (
            <p className="text-xs text-primary">The current period is still running, so its totals cover fewer days than the previous one.</p>
          )}
        </>
      )}
    </section>
  );
}
