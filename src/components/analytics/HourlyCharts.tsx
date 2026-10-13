"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatChartAxisUSD, formatChartHour, formatChartUSD, isoHour } from "@/components/chart/chartFormat";
import { hourlyTotals, type AnalyticsFilter, type HourlyAnalyticsResponse } from "@/lib/analytics";
import { HOURLY_ANALYTICS_DAYS } from "@/lib/hourlyData";
import { SeriesChart } from "./SeriesChart";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; data: HourlyAnalyticsResponse };

const telPrice = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 3 });
const formatTelPrice = (value: number | null) => (value === null ? "Unavailable" : telPrice.format(value));

/**
 * The program's TVL, volume, fees and TEL price hour by hour over the last HOURLY_ANALYTICS_DAYS days, for the
 * pools `filter` keeps, from GET /api/analytics/hourly. Loads when shown.
 */
export default function HourlyCharts({ filter }: { filter: AnalyticsFilter }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analytics/hourly")
      .then(async res => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as HourlyAnalyticsResponse;
      })
      .then(data => !cancelled && setLoad({ state: "ready", data }))
      .catch(() => !cancelled && setLoad({ state: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => (load.state === "ready" ? hourlyTotals(load.data, filter) : []), [load, filter]);

  return (
    <section aria-labelledby="analytics-hourly" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="analytics-hourly" className="text-xl">
          By the hour
        </h2>
        {load.state === "ready" && (
          <p className="text-xs text-primary">
            Hourly figures for the last {HOURLY_ANALYTICS_DAYS} days, at each hour&apos;s close in UTC. Hourly data is kept for {load.data.retentionDays} days
            {load.data.historyFrom !== null && load.data.historyFrom > load.data.from ? `, and starts ${formatChartHour(isoHour(load.data.historyFrom))}` : ""}.
          </p>
        )}
      </div>
      {load.state === "loading" && <p className="text-sm text-primary">Loading hourly figures…</p>}
      {load.state === "error" && <p className="text-sm text-yellow-400">Hourly figures are unavailable right now.</p>}
      {load.state === "ready" && rows.length === 0 && <p className="text-sm text-primary">Hourly figures start once the first hour is recorded.</p>}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SeriesChart
            hourly
            title="TVL by the hour"
            rows={rows}
            filename="telx-tvl-hourly.csv"
            series={[{ key: "tvlUSD", label: "TVL", color: "#ffffff", format: formatChartUSD, axis: formatChartAxisUSD }]}
          />
          <SeriesChart
            hourly
            title="Volume per hour"
            rows={rows}
            filename="telx-volume-hourly.csv"
            series={[{ key: "volumeUSD", label: "Volume", color: "#ffffff", format: formatChartUSD, axis: formatChartAxisUSD, kind: "bar" }]}
          />
          <SeriesChart
            hourly
            title="Fees per hour"
            rows={rows}
            filename="telx-fees-hourly.csv"
            series={[{ key: "feesUSD", label: "Fees", color: "#8a9dff", format: formatChartUSD, axis: formatChartAxisUSD, kind: "bar" }]}
          />
          <SeriesChart
            hourly
            title="TEL price by the hour"
            rows={rows}
            filename="telx-tel-price-hourly.csv"
            series={[{ key: "telUSD", label: "TEL", color: "#37aeff", format: formatTelPrice }]}
          />
        </div>
      )}
    </section>
  );
}
