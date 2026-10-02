import React, { useCallback, useMemo, useState } from "react";
import { ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, CartesianGrid, ComposedChart, Line } from "recharts";
import { formatChartAxisDate, formatChartAxisUSD, formatChartDate, formatChartUSD } from "./chartFormat";

// note from Akhil: we will not be using '@tremor/react' anymore. it does not support react 19, and conflicts with our npm. Instead we should be using Tremor Raw (tremor's copy-paste components).
// more info: https://tremor.so/docs/getting-started/installation/next
// more info: https://tremor.so/docs/visualizations/area-chart

/** One bar: its "YYYY-MM-DD" day bucket and its USD value. */
export interface ChartPoint {
  date: string;
  value: number;
}

/** A second series drawn as a line over the bars, by day label (SVL over TVL). Days without a value leave a gap. */
export interface ChartOverlay {
  label: string;
  byDate: Record<string, number>;
}

/** A bar with the overlay's value for its day, null when the overlay has none. */
type OverlaidPoint = ChartPoint & { overlay: number | null };

interface ChartProps {
  weights: number[];
  labels: string[];
  /** Metric name for the tooltip, matching the active tab (TVL, Volume, Fees). */
  metricLabel: string;
  selectedDays: number;
  /** Called with the bar under the pointer, keyboard focus or finger, and with null when it is released. */
  onActivePointChange?: (point: ChartPoint | null) => void;
  /** A series drawn as a line over the bars. */
  overlay?: ChartOverlay;
  /** Days whose figures are estimates rather than recorded values; the tooltip says so. */
  estimatedDates?: ReadonlySet<string>;
  /** What the estimate note names, such as "SVL". */
  estimateSubject?: string;
}

/** The subset of Recharts' chart event state that identifies the active bar. */
interface ChartEventState {
  isTooltipActive?: boolean;
  activeTooltipIndex?: number;
}

// Theme tokens from globals.css, so the chart follows the theme.
const BAR_COLOR = "var(--color-accent)";
const ACTIVE_BAR_COLOR = "var(--color-accent-light)";
const OVERLAY_COLOR = "var(--color-tblue-500)";
const AXIS_TICK = { fill: "var(--color-primary)" };

/** The point a Recharts chart event refers to, or null when no bar is active. */
export function activePointFromChartState(state: ChartEventState | null | undefined, data: ChartPoint[]): ChartPoint | null {
  if (!state?.isTooltipActive || typeof state.activeTooltipIndex !== "number") return null;
  return data[state.activeTooltipIndex] ?? null;
}

/** Adds the overlay's value to each point by its day. */
export function withOverlay(points: ChartPoint[], overlay: ChartOverlay): OverlaidPoint[] {
  return points.map(point => ({ ...point, overlay: overlay.byDate[point.date] ?? null }));
}

/** The last `days` points. `getChartData` returns labels in the reverse order of their weights, so labels are flipped to line up. */
export function buildChartData(weights: number[], labels: string[], days: number): ChartPoint[] {
  const start = Math.max(0, weights.length - days);
  const chronologicalLabels = [...labels].reverse();
  return weights.slice(start).map((value, i) => ({ date: chronologicalLabels[start + i], value }));
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: Array<{ value?: number | string; payload?: Partial<OverlaidPoint> }>;
  label?: string;
  metricLabel: string;
  overlayLabel?: string;
  estimatedDates?: ReadonlySet<string>;
  estimateSubject?: string;
}

export function ChartTooltipContent({ active, payload, label, metricLabel, overlayLabel, estimatedDates, estimateSubject }: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const raw = payload[0]?.value;
  const value = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
  const overlay = payload[0]?.payload?.overlay;
  const estimated = Boolean(label && estimatedDates?.has(label));
  return (
    <div className="rounded-lg border border-popover-border bg-popover/95 px-3 py-2 text-sm text-white shadow-xl shadow-black/50 backdrop-blur-md">
      {label && <p className="text-primary text-xs">{formatChartDate(label)}</p>}
      <p className="mt-1 flex gap-3">
        <span className="text-primary">{metricLabel}</span>
        <span className="font-semibold">{formatChartUSD(value)}</span>
      </p>
      {overlayLabel && (
        <p className="mt-1 flex gap-3">
          <span className="flex items-center gap-1.5 text-primary">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: OVERLAY_COLOR }} />
            {overlayLabel}
          </span>
          <span className="font-semibold">{overlay == null ? "No campaign" : formatChartUSD(overlay)}</span>
        </p>
      )}
      {estimated && <p className="mt-1 text-xs text-primary">{estimateSubject ?? "This figure"} is our estimate for this day.</p>}
    </div>
  );
}

export default function PoolChart(props: ChartProps) {
  const { weights, labels, metricLabel, selectedDays, onActivePointChange, overlay, estimatedDates, estimateSubject } = props;
  // Stable points, so a move within one bar reports the same object and the headline does not re-render.
  const chartdata = useMemo(() => {
    const points = buildChartData(weights, labels, selectedDays);
    return overlay ? withOverlay(points, overlay) : points;
  }, [weights, labels, selectedDays, overlay]);
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

  const title = overlay
    ? `${metricLabel} and ${overlay.label} by day, last ${selectedDays} days`
    : `${metricLabel} by day, last ${selectedDays} days`;
  const desc = "Use the left and right arrow keys to read the value of each day.";

  // A chart with an overlay draws its line over the bars, which needs Recharts' composed chart.
  const Chart = overlay ? ComposedChart : BarChart;
  const renderChart = (height: number, yAxisWidth: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={chartdata} accessibilityLayer title={title} desc={desc} onMouseMove={handleMove} onMouseLeave={release}>
        <CartesianGrid strokeDasharray="0" vertical={false} strokeOpacity={0.2} />
        <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} fontSize={12} tickFormatter={formatChartAxisDate} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={formatChartAxisUSD} width={yAxisWidth} fontSize={12} />
        <Tooltip
          cursor={{ fill: BAR_COLOR, fillOpacity: 0.12 }}
          content={
            <ChartTooltipContent metricLabel={metricLabel} overlayLabel={overlay?.label} estimatedDates={estimatedDates} estimateSubject={estimateSubject} />
          }
        />
        <Bar dataKey="value" name={metricLabel} fill={BAR_COLOR} activeBar={{ fill: ACTIVE_BAR_COLOR }} />
        {overlay && (
          <Line dataKey="overlay" name={overlay.label} type="monotone" stroke={OVERLAY_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        )}
      </Chart>
    </ResponsiveContainer>
  );

  return (
    <div data-testid="pool-chart" onBlur={handleBlur} key={resetKey}>
      <div className="hidden md:block">{renderChart(480, 64)}</div>
      <div className="md:hidden">{renderChart(280, 52)}</div>
    </div>
  );
}
