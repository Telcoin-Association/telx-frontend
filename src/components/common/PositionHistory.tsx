"use client";

import React, { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartAxisUSD, formatChartDate, formatChartHour, formatChartUSD, isoHour, timeAxisTicks } from "@/components/chart/chartFormat";
import { axisWidth, paddedAxis, usdTickFormatter } from "@/components/chart/paddedAxis";
import { HOURLY_RETENTION_DAYS } from "@/lib/hourlyData";
import { formatTokenAmount } from "@/lib/positionView";
import type { RpcChain } from "@/lib/rpc";
import { isFullRangeTicks } from "@/lib/v4/positionMetrics";
import { formatPrice } from "@/lib/priceFormat";

/** The body of GET /api/positions/history, as the panel reads it (see PositionHistory in src/server/positions/history.ts). */
export type PositionHistoryData = {
  currency0: { symbol: string };
  currency1: { symbol: string };
  tickLower: number;
  tickUpper: number;
  priceLower: number | null;
  priceUpper: number | null;
  currentPrice: number | null;
  inRange: boolean | null;
  /**
   * Daily points, hourly points, or daily points then hourly ones. Absent from responses cached before hourly
   * points existed, which are daily.
   */
  granularity?: "day" | "hour" | "mixed";
  /**
   * Start of the first hourly point, unix seconds; points before it are days. Null when every point is a day.
   * Absent from responses cached before it existed, whose points all share `granularity`.
   */
  hourlyFrom?: number | null;
  days: { day: number; price: number | null; inRange: boolean | null; valueUSD: number | null; heldUSD: number | null }[];
  /**
   * Daily points by daily close and hourly points by hourly close. Responses cached before `hours` existed count
   * their points in `days`, whatever their granularity.
   */
  timeInRange: { days: number; inRangeDays: number; hours?: number; inRangeHours?: number };
  fees: { amount0: number; amount1: number; usd: number | null } | null;
  /** Absent from responses cached before it existed. */
  performance?: PositionPerformanceData;
  historyFrom: number | null;
  notes: string[];
};

/** `openFrom` is absent from responses cached before it existed. */
type PriceChangeData = { open: number | null; now: number | null; change: number | null; openFrom?: "block" | "stored" | "polygon" | null };

/** See PositionPerformance in src/server/positions/history.ts. Fractions: 0.05 is 5%. */
export type PositionPerformanceData = {
  openedAt: number | null;
  priceChange: { token0: PriceChangeData; token1: PriceChangeData };
  depositedUSD: number | null;
  withdrawnUSD: number | null;
  valueUSD: number | null;
  heldUSD: number | null;
  impermanentLoss: number | null;
  rewards: { amount: number; symbol: string; usd: number | null } | null;
  feesAndRewardsUSD: number | null;
  pnlUSD: number | null;
  pnl: number | null;
};

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: PositionHistoryData };

const isoDay = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/** Days and hours in range, each counted by its own close. */
export type TimeInRange = { days: number; inRangeDays: number; hours: number; inRangeHours: number };

/** The response's time in range, reading a response cached before hourly counts had their own fields. */
export function timeInRangeOf(data: Pick<PositionHistoryData, "granularity" | "timeInRange">): TimeInRange {
  const { days, inRangeDays, hours, inRangeHours } = data.timeInRange;
  if (hours !== undefined) return { days, inRangeDays, hours, inRangeHours: inRangeHours ?? 0 };
  return data.granularity === "hour" ? { days: 0, inRangeDays: 0, hours: days, inRangeHours: inRangeDays } : { days, inRangeDays, hours: 0, inRangeHours: 0 };
}

/** The share of time in range, weighting a day as 24 hours, as a whole percentage; null with nothing counted. */
export function timeInRangeShare({ days, inRangeDays, hours, inRangeHours }: TimeInRange): number | null {
  const total = days * 24 + hours;
  return total > 0 ? Math.round(((inRangeDays * 24 + inRangeHours) / total) * 100) : null;
}

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "2 of 30 days by daily close, then 600 of 720 hours by hourly close", leaving out a part with nothing counted. */
export function describeTimeInRange({ days, inRangeDays, hours, inRangeHours }: TimeInRange): string {
  const parts = [days > 0 ? `${inRangeDays} of ${count(days, "day")} by daily close` : null, hours > 0 ? `${inRangeHours} of ${count(hours, "hour")} by hourly close` : null];
  return parts.filter(Boolean).join(", then ");
}

export { formatPrice };

const percent = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: "exceptZero" });
/** A fraction as a signed percentage: 0.0234 reads "+2.34%", -0.005 "-0.5%". */
export function formatChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return percent.format(value);
}

/** A signed dollar amount: "+$38.33", "-$4.10". */
export function formatSignedUSD(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatChartUSD(Math.abs(value))}`;
}

const toneOf = (value: number | null | undefined) => (value == null || value === 0 ? "text-white" : value > 0 ? "text-green-400" : "text-red-300");

export const isFullRange = isFullRangeTicks;

/**
 * A position's history under its row: first its profit and loss, then a compact breakdown (each token's price
 * since the position opened, impermanent loss, fees and rewards, time in range), then value against keeping the
 * deposit as tokens and the pool price over time with the position's range as a band, then the caveats. Loads when opened. Each chart has a text
 * alternative, and the figures a chart shows are also given as text.
 */
export default function PositionHistory({ chain, tokenId }: { chain: RpcChain; tokenId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    fetch(`/api/positions/history?chain=${chain}&tokenId=${encodeURIComponent(tokenId)}`)
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 404 ? "This position isn't in a TELx pool." : "The position history could not be loaded.");
        return (await res.json()) as PositionHistoryData;
      })
      .then(data => !cancelled && setLoad({ state: "ready", data }))
      .catch((error: Error) => !cancelled && setLoad({ state: "error", message: error.message }));
    return () => {
      cancelled = true;
    };
  }, [chain, tokenId]);

  if (load.state === "loading") return <p className="text-xs text-primary">Loading position history…</p>;
  if (load.state === "error") return <p className="text-xs text-yellow-400">{load.message}</p>;

  const { data } = load;
  const pair = `${data.currency1.symbol} per ${data.currency0.symbol}`;
  // Points from hourlyFrom on are hours, earlier ones days.
  const hourlyFrom = data.hourlyFrom !== undefined ? data.hourlyFrom : data.granularity === "hour" ? (data.days[0]?.day ?? null) : null;
  const isHour = (unixSeconds: number) => hourlyFrom !== null && unixSeconds >= hourlyFrom;
  const formatPoint = (unixSeconds: number) => (isHour(unixSeconds) ? formatChartHour(isoHour(unixSeconds)) : formatChartDate(isoDay(unixSeconds)));
  // Both parts are drawn when some points are days and some are hours; the boundary is marked on each chart.
  const mixed = hourlyFrom !== null && data.days.some(day => day.day < hourlyFrom) && data.days.some(day => day.day >= hourlyFrom);
  const points = data.days.map(day => ({ t: day.day * 1000, value: day.valueUSD, held: day.heldUSD, price: day.price }));
  // The X axis is time, so a day takes 24 times the width of an hour and the hourly part doesn't crowd out the rest.
  const xAxis = points.length ? timeAxisTicks(points[0].t, points[points.length - 1].t) : null;
  const latest = [...data.days].reverse().find(day => day.valueUSD !== null);
  const difference = latest && latest.valueUSD !== null && latest.heldUSD !== null ? latest.valueUSD - latest.heldUSD : null;
  const timeInRange = timeInRangeOf(data);
  const inRangeShare = timeInRangeShare(timeInRange);
  const hourlyLine = mixed ? `Hourly points from ${formatPoint(hourlyFrom!)}.` : "";
  const resolutionNote = mixed
    ? `One point per day at each day's closing price, then one per hour from ${formatPoint(hourlyFrom!)} at each hour's closing price.`
    : hourlyFrom !== null
      ? "One point per hour, at each hour's closing price."
      : "One point per day, at each day's closing price.";
  const prices = points.map(point => point.price).filter((price): price is number => price !== null && Number.isFinite(price));
  const fullRange = isFullRange(data.tickLower, data.tickUpper);
  const band = fullRange ? [] : [data.priceLower, data.priceUpper].filter((price): price is number => price !== null && Number.isFinite(price));
  const domain: [number, number] | undefined = prices.length
    ? [Math.min(...prices, ...band.filter(price => price >= Math.min(...prices) / 3)) * 0.95, Math.max(...prices, ...band.filter(price => price <= Math.max(...prices) * 3)) * 1.05]
    : undefined;

  // The value chart's axis spans both lines with 5% padding rather than starting at $0, so the gap between them shows.
  const valueAxis = paddedAxis(points.flatMap(point => [point.value, point.held]));
  const valueTick = valueAxis ? usdTickFormatter(valueAxis) : formatChartAxisUSD;
  const valueAxisWidth = valueAxis ? axisWidth(valueAxis.ticks.map(valueTick)) : 56;

  const performance = data.performance;
  const putIn = performance?.depositedUSD ?? null;
  const takenOut = performance?.withdrawnUSD ?? null;

  const valueSummary = latest
    ? `Value on ${formatPoint(latest.day)}: ${formatChartUSD(latest.valueUSD)}` +
      (latest.heldUSD !== null ? `, against ${formatChartUSD(latest.heldUSD)} had the deposit been held.` : ".")
    : `No ${hourlyFrom !== null && !mixed ? "hour" : "day"} could be valued yet.`;
  const rangeSummary =
    (fullRange ? `Full range. Now ${formatPrice(data.currentPrice)} ${pair}.` : `Range ${formatPrice(data.priceLower)} to ${formatPrice(data.priceUpper)} ${pair}. Now ${formatPrice(data.currentPrice)}.`) +
    (inRangeShare !== null && !fullRange ? ` In range ${describeTimeInRange(timeInRange)}.` : "");
  const chartLabel = (summary: string) => (hourlyLine ? `${summary} ${hourlyLine}` : summary);
  const xAxisProps = {
    dataKey: "t",
    type: "number" as const,
    scale: "time" as const,
    domain: ["dataMin", "dataMax"],
    ticks: xAxis?.ticks,
    tickFormatter: (value: number) => xAxis?.format(value) ?? "",
    stroke: "currentColor",
    fontSize: 11,
    minTickGap: 24,
  };
  const tooltipLabel = (value: unknown) => formatPoint(Number(value) / 1000);
  const hourlyMark = mixed && (
    <ReferenceLine
      x={hourlyFrom! * 1000}
      stroke="rgba(255,255,255,0.35)"
      strokeDasharray="2 4"
      label={{ value: "Hourly", position: "insideTopLeft", fill: "currentColor", fontSize: 10 }}
    />
  );

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-black/20 p-4 text-xs text-primary">
      {performance && (
        <section aria-label="Profit and loss" className="flex flex-col gap-1">
          <p>Profit and loss</p>
          <p className="flex flex-wrap items-baseline gap-x-2 text-2xl text-white">
            <span className={toneOf(performance.pnlUSD)}>{formatSignedUSD(performance.pnlUSD)}</span>
            {performance.pnl !== null && <span className={`text-base ${toneOf(performance.pnl)}`}>{formatChange(performance.pnl)}</span>}
          </p>
          {putIn !== null && (
            <p>
              {formatChartUSD(putIn)} put in{takenOut ? `, ${formatChartUSD(takenOut)} taken out` : ""}, {formatChartUSD(performance.valueUSD)} in the position now
              {performance.feesAndRewardsUSD !== null ? `, plus ${formatChartUSD(performance.feesAndRewardsUSD)} in fees and rewards.` : "."}
            </p>
          )}
        </section>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {performance && (
          <div>
            <dt>Prices since opening</dt>
            <dd className="text-sm text-white">
              {data.currency0.symbol} <span className={toneOf(performance.priceChange.token0.change)}>{formatChange(performance.priceChange.token0.change)}</span>
            </dd>
            <dd className="text-sm text-white">
              {data.currency1.symbol} <span className={toneOf(performance.priceChange.token1.change)}>{formatChange(performance.priceChange.token1.change)}</span>
            </dd>
          </div>
        )}
        <div>
          <dt>Impermanent loss</dt>
          <dd className="text-sm text-white">{performance ? formatChange(performance.impermanentLoss) : "Unavailable"}</dd>
          {difference !== null && (
            <dd>
              {formatSignedUSD(difference)} against holding the tokens
            </dd>
          )}
        </div>
        <div>
          <dt>{performance ? "Fees and rewards" : "Uncollected fees"}</dt>
          <dd className="text-sm text-white">{formatChartUSD(performance?.feesAndRewardsUSD ?? data.fees?.usd)}</dd>
          {data.fees && (
            <dd>
              {formatChartUSD(data.fees.usd)} uncollected fees: {formatTokenAmount(String(data.fees.amount0))} {data.currency0.symbol} and{" "}
              {formatTokenAmount(String(data.fees.amount1))} {data.currency1.symbol}
            </dd>
          )}
          {performance?.rewards && (
            <dd>
              {formatChartUSD(performance.rewards.usd)} TELx rewards: {formatTokenAmount(String(performance.rewards.amount))} {performance.rewards.symbol}
            </dd>
          )}
        </div>
        <div>
          <dt>Time in range</dt>
          <dd className="text-sm text-white">{fullRange ? "Always (full range)" : inRangeShare !== null ? `${inRangeShare}%` : "Unavailable"}</dd>
          {inRangeShare !== null && !fullRange && (
            <dd>
              {describeTimeInRange(timeInRange)}
            </dd>
          )}
        </div>
      </dl>

      <figure className="flex flex-col gap-2">
        <figcaption className="text-white">Value against holding the deposit</figcaption>
        <div role="img" aria-label={chartLabel(valueSummary)}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis
                domain={valueAxis?.domain ?? ["auto", "auto"]}
                ticks={valueAxis?.ticks}
                tickFormatter={valueTick}
                stroke="currentColor"
                fontSize={11}
                width={valueAxisWidth}
                allowDataOverflow
              />
              {hourlyMark}
              <Tooltip labelFormatter={tooltipLabel} formatter={(value, name) => [formatChartUSD(Number(value)), name === "value" ? "Position" : "Held instead"]} />
              <Line type="monotone" dataKey="value" name="value" stroke="var(--color-accent, #4967ff)" dot={false} strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="held" name="held" stroke="#a3a3a3" strokeDasharray="4 4" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p>{valueSummary}</p>
      </figure>

      <figure className="flex flex-col gap-2">
        <figcaption className="text-white">{fullRange ? `Price (${pair})` : `Price (${pair}) and the position’s range`}</figcaption>
        <div role="img" aria-label={chartLabel(rangeSummary)}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis domain={domain ?? ["auto", "auto"]} tickFormatter={value => formatPrice(Number(value))} stroke="currentColor" fontSize={11} width={64} allowDataOverflow />
              {!fullRange && data.priceLower !== null && data.priceUpper !== null && (
                <ReferenceArea y1={data.priceLower} y2={data.priceUpper} ifOverflow="hidden" fill="#4967ff" fillOpacity={0.15} />
              )}
              {hourlyMark}
              <Tooltip labelFormatter={tooltipLabel} formatter={value => [formatPrice(Number(value)), pair]} />
              <Line type="monotone" dataKey="price" stroke="#ffffff" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p>{rangeSummary}</p>
      </figure>

      {performance && (
        <p>
          These figures are estimates. Each deposit and withdrawal is valued at the prices when it happened. Fees already
          collected aren&apos;t counted. TELx rewards are Merkl&apos;s figures for this position, valued at today&apos;s TEL price.
        </p>
      )}
      {data.historyFrom !== null && <p>History since {formatPoint(data.historyFrom)}.</p>}
      <p>
        {resolutionNote} Hourly prices are kept for the last {HOURLY_RETENTION_DAYS} days, so earlier history is shown by the day.
      </p>
      {data.notes.map(note => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}
