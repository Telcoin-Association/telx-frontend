import React, { useCallback, useMemo, useState } from "react";
import { ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, CartesianGrid } from "recharts";
import { formatChartAxisDate, formatChartAxisUSD, formatChartDate, formatChartUSD } from "./chartFormat";

// note from Akhil: we will not be using '@tremor/react' anymore. it does not support react 19, and conflicts with our npm. Instead we should be using Tremor Raw (tremor's copy-paste components).
// more info: https://tremor.so/docs/getting-started/installation/next
// more info: https://tremor.so/docs/visualizations/area-chart

/** One bar: its "YYYY-MM-DD" day bucket and its USD value. */
export interface ChartPoint {
  date: string;
  value: number;
}

interface ChartProps {
  weights: number[];
  labels: string[];
  /** Metric name for the tooltip, matching the active tab (TVL, Volume, Fees). */
  metricLabel: string;
  selectedDays: number;
  /** Called with the bar under the pointer, keyboard focus or finger, and with null when it is released. */
  onActivePointChange?: (point: ChartPoint | null) => void;
}

/** The subset of Recharts' chart event state that identifies the active bar. */
interface ChartEventState {
  isTooltipActive?: boolean;
  activeTooltipIndex?: number;
}

// Theme tokens from globals.css, so the chart follows the theme.
const BAR_COLOR = "var(--color-accent)";
const ACTIVE_BAR_COLOR = "var(--color-accent-light)";
const AXIS_TICK = { fill: "var(--color-primary)" };

/** The point a Recharts chart event refers to, or null when no bar is active. */
export function activePointFromChartState(state: ChartEventState | null | undefined, data: ChartPoint[]): ChartPoint | null {
  if (!state?.isTooltipActive || typeof state.activeTooltipIndex !== "number") return null;
  return data[state.activeTooltipIndex] ?? null;
}

/** The last `days` points. `getChartData` returns labels in the reverse order of their weights, so labels are flipped to line up. */
export function buildChartData(weights: number[], labels: string[], days: number): ChartPoint[] {
  const start = Math.max(0, weights.length - days);
  const chronologicalLabels = [...labels].reverse();
  return weights.slice(start).map((value, i) => ({ date: chronologicalLabels[start + i], value }));
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string;
  metricLabel: string;
}

export function ChartTooltipContent({ active, payload, label, metricLabel }: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const raw = payload[0]?.value;
  const value = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
  return (
    <div className="rounded-lg border border-popover-border bg-popover/95 px-3 py-2 text-sm text-white shadow-xl shadow-black/50 backdrop-blur-md">
      {label && <p className="text-primary text-xs">{formatChartDate(label)}</p>}
      <p className="mt-1 flex gap-3">
        <span className="text-primary">{metricLabel}</span>
        <span className="font-semibold">{formatChartUSD(value)}</span>
      </p>
    </div>
  );
}

export default function PoolChart(props: ChartProps) {
  const { weights, labels, metricLabel, selectedDays, onActivePointChange } = props;
  // Stable points, so a move within one bar reports the same object and the headline does not re-render.
  const chartdata = useMemo(() => buildChartData(weights, labels, selectedDays), [weights, labels, selectedDays]);
  // Remounting the chart clears Recharts' own tooltip and active bar, which only a mouse leave clears.
  const [resetKey, setResetKey] = useState(0);

  const handleMove = useCallback(
    (state: ChartEventState) => onActivePointChange?.(activePointFromChartState(state, chartdata)),
    [onActivePointChange, chartdata],
  );
  const release = useCallback(() => onActivePointChange?.(null), [onActivePointChange]);

  // Focus leaving the chart ends the keyboard selection: the tooltip, the active bar and the headline all
  // return to rest together. A touch keeps its bar selected, in step with the tooltip, until the next touch.
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    release();
    setResetKey((key) => key + 1);
  };

  const title = `${metricLabel} by day, last ${selectedDays} days`;
  const desc = "Use the left and right arrow keys to read the value of each day.";

  const renderChart = (height: number, yAxisWidth: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartdata} accessibilityLayer title={title} desc={desc} onMouseMove={handleMove} onMouseLeave={release}>
        <CartesianGrid strokeDasharray="0" vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} fontSize={12} tickFormatter={formatChartAxisDate} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={formatChartAxisUSD} width={yAxisWidth} fontSize={12} />
        <Tooltip cursor={{ fill: BAR_COLOR, fillOpacity: 0.12 }} content={<ChartTooltipContent metricLabel={metricLabel} />} />
        <Bar dataKey="value" name={metricLabel} fill={BAR_COLOR} activeBar={{ fill: ACTIVE_BAR_COLOR }} />
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <div data-testid="pool-chart" onBlur={handleBlur} key={resetKey}>
      <div className="hidden md:block">{renderChart(480, 64)}</div>
      <div className="md:hidden">{renderChart(280, 52)}</div>
    </div>
  );
}
