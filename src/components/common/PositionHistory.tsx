"use client";

import React, { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartAxisDate, formatChartAxisUSD, formatChartDate, formatChartUSD } from "@/components/chart/chartFormat";
import { formatTokenAmount } from "@/lib/positionView";
import type { RpcChain } from "@/lib/rpc";

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
  days: { day: number; price: number | null; inRange: boolean | null; valueUSD: number | null; heldUSD: number | null }[];
  timeInRange: { days: number; inRangeDays: number };
  fees: { amount0: number; amount1: number; usd: number | null } | null;
  historyFrom: number | null;
  notes: string[];
};

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: PositionHistoryData };

const isoDay = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

// Prices span many orders of magnitude (TEL per WETH is about a million, WETH per TEL a millionth), so they read
// compactly with three significant digits: "1.16M", "4,980", "0.000859".
const compactPrice = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });
const plainPrice = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return Math.abs(value) >= 10_000 ? compactPrice.format(value) : plainPrice.format(value);
}

/** The usable tick limits are within one tick spacing of Uniswap's ±887,272, so this catches every full-range position. */
const FULL_RANGE_TICK = 887_000;
export const isFullRange = (tickLower: number, tickUpper: number) => tickLower <= -FULL_RANGE_TICK && tickUpper >= FULL_RANGE_TICK;

/**
 * A position's history under its row: value against keeping the deposit as tokens, uncollected fees, and the
 * pool price over time with the position's range as a band. Loads when opened. Each chart has a text
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
  const points = data.days.map(day => ({ date: isoDay(day.day), value: day.valueUSD, held: day.heldUSD, price: day.price }));
  const latest = [...data.days].reverse().find(day => day.valueUSD !== null);
  const difference = latest && latest.valueUSD !== null && latest.heldUSD !== null ? latest.valueUSD - latest.heldUSD : null;
  const inRangeShare = data.timeInRange.days > 0 ? Math.round((data.timeInRange.inRangeDays / data.timeInRange.days) * 100) : null;
  const prices = points.map(point => point.price).filter((price): price is number => price !== null && Number.isFinite(price));
  const fullRange = isFullRange(data.tickLower, data.tickUpper);
  const band = fullRange ? [] : [data.priceLower, data.priceUpper].filter((price): price is number => price !== null && Number.isFinite(price));
  const domain: [number, number] | undefined = prices.length
    ? [Math.min(...prices, ...band.filter(price => price >= Math.min(...prices) / 3)) * 0.95, Math.max(...prices, ...band.filter(price => price <= Math.max(...prices) * 3)) * 1.05]
    : undefined;

  const valueSummary = latest
    ? `Value on ${formatChartDate(isoDay(latest.day))}: ${formatChartUSD(latest.valueUSD)}` +
      (latest.heldUSD !== null ? `, against ${formatChartUSD(latest.heldUSD)} had the deposit been held.` : ".")
    : "No day could be valued yet.";
  const rangeSummary =
    (fullRange ? `Full range. Now ${formatPrice(data.currentPrice)} ${pair}.` : `Range ${formatPrice(data.priceLower)} to ${formatPrice(data.priceUpper)} ${pair}. Now ${formatPrice(data.currentPrice)}.`) +
    (inRangeShare !== null && !fullRange ? ` In range ${data.timeInRange.inRangeDays} of ${data.timeInRange.days} days.` : "");

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-black/20 p-4 text-xs text-primary">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt>Value now</dt>
          <dd className="text-sm text-white">{formatChartUSD(latest?.valueUSD)}</dd>
          {difference !== null && (
            <dd>
              {difference >= 0 ? "+" : "-"}
              {formatChartUSD(Math.abs(difference))} against holding
            </dd>
          )}
        </div>
        <div>
          <dt>Uncollected fees</dt>
          {data.fees ? (
            <>
              <dd className="text-sm text-white">{formatChartUSD(data.fees.usd)}</dd>
              <dd>
                {formatTokenAmount(String(data.fees.amount0))} {data.currency0.symbol} and {formatTokenAmount(String(data.fees.amount1))} {data.currency1.symbol}
              </dd>
            </>
          ) : (
            <dd className="text-sm text-white">Unavailable</dd>
          )}
        </div>
        <div>
          <dt>Time in range</dt>
          <dd className="text-sm text-white">{fullRange ? "Always (full range)" : inRangeShare !== null ? `${inRangeShare}%` : "Unavailable"}</dd>
          {inRangeShare !== null && !fullRange && (
            <dd>
              {data.timeInRange.inRangeDays} of {data.timeInRange.days} days, by daily close
            </dd>
          )}
        </div>
      </dl>

      <figure className="flex flex-col gap-2">
        <figcaption className="text-white">Value against holding the deposit</figcaption>
        <div role="img" aria-label={valueSummary}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatChartAxisDate} stroke="currentColor" fontSize={11} />
              <YAxis tickFormatter={formatChartAxisUSD} stroke="currentColor" fontSize={11} width={56} />
              <Tooltip labelFormatter={label => formatChartDate(String(label))} formatter={(value, name) => [formatChartUSD(Number(value)), name === "value" ? "Position" : "Held instead"]} />
              <Line type="monotone" dataKey="value" name="value" stroke="var(--color-accent, #4967ff)" dot={false} strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="held" name="held" stroke="#a3a3a3" strokeDasharray="4 4" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p>{valueSummary}</p>
      </figure>

      <figure className="flex flex-col gap-2">
        <figcaption className="text-white">{fullRange ? `Price (${pair})` : `Price (${pair}) and the position’s range`}</figcaption>
        <div role="img" aria-label={rangeSummary}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatChartAxisDate} stroke="currentColor" fontSize={11} />
              <YAxis domain={domain ?? ["auto", "auto"]} tickFormatter={value => formatPrice(Number(value))} stroke="currentColor" fontSize={11} width={64} allowDataOverflow />
              {!fullRange && data.priceLower !== null && data.priceUpper !== null && (
                <ReferenceArea y1={data.priceLower} y2={data.priceUpper} ifOverflow="hidden" fill="#4967ff" fillOpacity={0.15} />
              )}
              <Tooltip labelFormatter={label => formatChartDate(String(label))} formatter={value => [formatPrice(Number(value)), pair]} />
              <Line type="monotone" dataKey="price" stroke="#ffffff" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p>{rangeSummary}</p>
      </figure>

      {data.historyFrom !== null && <p>History since {formatChartDate(isoDay(data.historyFrom))}.</p>}
      {data.notes.map(note => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}
