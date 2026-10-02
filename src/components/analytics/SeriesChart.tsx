"use client";

import React, { useId } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartAxisDate, formatChartDate } from "@/components/chart/chartFormat";
import { downloadCsv, isoDay, toCsv, type CsvColumn } from "@/lib/analytics";

export const CHIP = "cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200";
export const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
export const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";

/** Line colours for charts with one series per pool: legible on the dark card and distinct from each other. */
export const SERIES_COLORS = ["#ffffff", "#8a9dff", "#37aeff", "#f5a524", "#9385ff", "#70deff", "#c9cfed", "#a3a3a3"];

export type Series<T> = { key: keyof T & string; label: string; color: string; format: (value: number | null) => string };

/**
 * The hover card for a series chart, on the app's popover surface: the date, then each series' label and value in
 * white beside a swatch of its line colour, so a white or grey line stays legible.
 */
export function SeriesTooltipContent<T>({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: unknown; value?: unknown }>;
  label?: unknown;
  series: Series<T>[];
}) {
  if (!active || !payload || payload.length === 0) return null;
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
    </div>
  );
}

/**
 * A line chart with a text alternative, the latest figures as text, a legend when it plots several series, and a
 * CSV download of the plotted series.
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
            </li>
          ))}
        </ul>
      )}
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatChartAxisDate} stroke="currentColor" fontSize={11} />
            <YAxis tickFormatter={value => series[0].format(Number(value))} stroke="currentColor" fontSize={11} width={64} />
            <Tooltip cursor={{ stroke: "rgba(255, 255, 255, 0.25)" }} content={<SeriesTooltipContent series={series} />} />
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
