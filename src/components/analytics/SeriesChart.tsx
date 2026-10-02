"use client";

import React, { useId } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartAxisDate, formatChartDate } from "@/components/chart/chartFormat";
import { downloadCsv, isoDay, toCsv, type CsvColumn } from "@/lib/analytics";

export const CHIP = "cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200";
export const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
export const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";

/** Line colours for charts with one series per pool: legible on the dark card and distinct from each other. */
export const SERIES_COLORS = ["#ffffff", "#8a9dff", "#37aeff", "#f5a524", "#9385ff", "#70deff", "#c9cfed", "#a3a3a3"];

/**
 * One series of a chart. `format` writes a value in full for the tooltip and summary; `axis` writes a Y-axis tick
 * compactly, so labels such as "$450K" fit the axis column.
 *
 * - `kind`: "bar" for amounts per day (volume, fees, TEL distributed), "line" (the default) for levels such as TVL,
 *   APR or cumulative totals. Lines are drawn straight between days, so no values between days are implied.
 * - `side`: "right" plots the series against its own axis on the right, for a series in other units or at a far
 *   smaller scale than the rest, such as fees beside volume. Each axis follows the first series on its side.
 * - `stack`: bars with the same stack id are stacked.
 */
export type Series<T> = {
  key: keyof T & string;
  label: string;
  color: string;
  format: (value: number | null) => string;
  axis?: (value: number) => string;
  kind?: "line" | "bar";
  side?: "left" | "right";
  stack?: string;
};

const axisFormatter = <T,>(item: Series<T>) => (value: unknown) => (item.axis ?? item.format)(Number(value));

/**
 * The hover card for a series chart, on the app's popover surface: the date, then each series' label and value in
 * white beside a swatch of its line colour, so a white or grey line stays legible. A row marked `fromReport` says
 * its figures come from the TELx daily report.
 */
export function SeriesTooltipContent<T>({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: unknown; value?: unknown; payload?: unknown }>;
  label?: unknown;
  series: Series<T>[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  const fromReport = typeof row === "object" && row !== null && (row as { fromReport?: unknown }).fromReport === true;
  return (
    <div className="rounded-lg border border-popover-border bg-popover/95 px-3 py-2 text-xs text-white shadow-xl shadow-black/50 backdrop-blur-md">
      {label !== undefined && <p className="mb-1 text-primary">{formatChartDate(String(label))}</p>}
      {payload.map(entry => {
        const item = series.find(candidate => candidate.key === entry.dataKey);
        if (!item) return null;
        const value = typeof entry.value === "number" ? entry.value : null;
        return (
          <p key={item.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-primary">{item.label}</span>
            <span className="ml-auto pl-3 font-semibold">{item.format(value)}</span>
          </p>
        );
      })}
      {fromReport && <p className="mt-1 text-primary">From the TELx daily report</p>}
    </div>
  );
}

/**
 * A chart of daily series with a text alternative, the latest figures as text, a legend when it plots several
 * series, and a CSV download of the plotted series.
 */
export function SeriesChart<T extends { day: number }>({
  title,
  rows,
  series,
  filename,
}: {
  title: string;
  rows: readonly T[];
  series: Series<T>[];
  filename: string;
}) {
  const captionId = useId();
  const points = rows.map(row => ({ ...row, date: isoDay(row.day) }));
  const latest = [...rows].reverse().find(row => series.some(item => typeof row[item.key] === "number"));
  const summary = latest
    ? `${title}, ${formatChartDate(isoDay(latest.day))}: ${series.map(item => `${item.label} ${item.format((latest[item.key] as number | null) ?? null)}`).join(", ")}.`
    : `${title}: nothing recorded yet.`;
  const left = series.filter(item => item.side !== "right");
  const right = series.filter(item => item.side === "right");
  const hasBars = series.some(item => item.kind === "bar");
  const columns: CsvColumn<T>[] = [
    { header: "date", value: row => isoDay(row.day) },
    ...series.map(item => ({ header: item.label, value: (row: T) => (row[item.key] as number | null) ?? null })),
  ];

  return (
    <figure aria-labelledby={captionId} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-black/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <figcaption id={captionId} className="text-sm text-white">
          {title}
        </figcaption>
        <button type="button" onClick={() => downloadCsv(filename, toCsv(columns, rows))} className={`${CHIP} ${CHIP_IDLE}`}>
          CSV
        </button>
      </div>
      {series.length > 1 && (
        <ul aria-hidden="true" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-primary">
          {series.map(item => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
              {right.length > 0 && left.length > 0 && item.side === "right" && " (right axis)"}
            </li>
          ))}
        </ul>
      )}
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={points} margin={{ top: 8, right: right.length > 0 ? 0 : 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatChartAxisDate} stroke="currentColor" fontSize={11} />
            <YAxis yAxisId="left" tickFormatter={axisFormatter(left[0] ?? series[0])} stroke="currentColor" fontSize={11} width={64} />
            {right.length > 0 && <YAxis yAxisId="right" orientation="right" tickFormatter={axisFormatter(right[0])} stroke="currentColor" fontSize={11} width={56} />}
            <Tooltip
              cursor={hasBars ? { fill: "rgba(255, 255, 255, 0.06)" } : { stroke: "rgba(255, 255, 255, 0.25)" }}
              content={<SeriesTooltipContent series={series} />}
            />
            {series.map(item =>
              item.kind === "bar" ? (
                <Bar
                  key={item.key}
                  yAxisId={item.side === "right" ? "right" : "left"}
                  dataKey={item.key}
                  name={item.key}
                  fill={item.color}
                  stackId={item.stack}
                  maxBarSize={28}
                  radius={item.stack ? 0 : [3, 3, 0, 0]}
                />
              ) : (
                <Line
                  key={item.key}
                  yAxisId={item.side === "right" ? "right" : "left"}
                  type="linear"
                  dataKey={item.key}
                  name={item.key}
                  stroke={item.color}
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-primary">{summary}</p>
    </figure>
  );
}
