"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import PoolChart, { ChartPoint } from "./PoolChart";
import { CHART_METRIC_LABELS, ChartMetric, describeChartPoint, formatChartDate, formatChartUSD } from "./chartFormat";
import { formatPoolAmount } from "@/helpers/formatPoolAmount";
import { ADD_LIQUIDITY_HASH, onOpenAddLiquidity } from "@/lib/poolPageEvents";
import { estimatedSvlDates, svlByDate, svlChartSeries, type SvlDay } from "@/lib/svl";
import { formatShareOfTvl } from "@/helpers/poolRewardsDisplay";

/**
 * A Merkl pool's subscribed liquidity: its daily history, and the live figure and share of TVL for the headline.
 */
export interface ChartSvl {
  days: SvlDay[];
  current: number | null;
  share: number | null;
}

interface ChartTabsProps {
  totalLiquidity?: number | null;
  dailyVolume?: number | null;
  dailyFees?: number | null;
  liquidityWeights?: number[];
  liquidityLabels?: string[];
  volumeWeights?: number[];
  volumeLabels?: string[];
  feeWeights?: number[];
  feeLabels?: string[];
  /** The Add liquidity tab's content; the tab shows only when this is given. */
  addLiquidity?: React.ReactNode;
  /** Subscribed liquidity; with history, an SVL tab shows and the TVL view draws SVL over its bars. */
  svl?: ChartSvl;
}

/** How long the selection has to rest on a bar before it is announced. */
export const ANNOUNCE_DELAY_MS = 600;

const METRIC_TAB = "relative py-2 px-4 cursor-pointer rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const ADD_TAB =
  "flex items-center gap-2 rounded-md bg-ocean-gradient px-4 py-2 text-sm font-bold text-white shadow-lg shadow-[#5533ff66] hover-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const noHistoricalData = <h3 className=" text-primary mt-10 text-center ">No historical data</h3>;

const ChartTabs: React.FC<ChartTabsProps> = ({
  totalLiquidity,
  dailyVolume,
  dailyFees,
  liquidityWeights,
  liquidityLabels,
  volumeWeights,
  volumeLabels,
  feeWeights,
  feeLabels,
  addLiquidity,
  svl,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  // The Add liquidity tab replaces the chart in the same card; it opens from its tab, from the page's
  // #add-liquidity link, or from the button under the positions list.
  const [adding, setAdding] = useState(false);
  const hasAddLiquidity = Boolean(addLiquidity);
  useEffect(() => {
    if (!hasAddLiquidity) return;
    const open = () => {
      setAdding(true);
      cardRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };
    if (window.location.hash === ADD_LIQUIDITY_HASH) open();
    const onHash = () => {
      if (window.location.hash === ADD_LIQUIDITY_HASH) open();
    };
    window.addEventListener("hashchange", onHash);
    const stopListening = onOpenAddLiquidity(open);
    return () => {
      window.removeEventListener("hashchange", onHash);
      stopListening();
    };
  }, [hasAddLiquidity]);

  const [selectedDays, setSelectedDays] = useState(90);
  const [activeTab, setActiveTab] = useState<ChartMetric>("liquidity");
  // The bar under the pointer, keyboard focus or finger; null shows the latest value.
  const [activePoint, setActivePoint] = useState<ChartPoint | null>(null);
  // The active bar, read out once the selection has settled on it rather than on every bar crossed.
  const [announcement, setAnnouncement] = useState("");

  // SVL history drives its own tab and the line over the TVL bars; estimate days are marked in the tooltip.
  const svlDays = svl?.days;
  const hasSvl = Boolean(svlDays && svlDays.length > 0);
  const svlChart = useMemo(
    () => (svlDays && svlDays.length > 0 ? { series: svlChartSeries(svlDays), overlay: { label: "SVL", byDate: svlByDate(svlDays) }, estimated: estimatedSvlDates(svlDays) } : null),
    [svlDays],
  );

  // At rest the headline is the pool's current figure: TVL and SVL now, and volume and fees over the trailing
  // 24 hours. A bar is a UTC day, captioned with its date.
  const latestSvl = svl?.current ?? (svlDays && svlDays.length > 0 ? svlDays[svlDays.length - 1].svlUSD : null);
  const latest: Record<ChartMetric, { value?: number | null; caption: string }> = {
    liquidity: { value: totalLiquidity, caption: "Current" },
    volume: { value: dailyVolume, caption: "Last 24 hours" },
    fees: { value: dailyFees, caption: "Last 24 hours" },
    svl: { value: latestSvl, caption: svl?.share != null ? `Current, ${formatShareOfTvl(svl.share)}` : "Current" },
  };
  const series: Record<ChartMetric, { weights?: number[]; labels?: string[] }> = {
    liquidity: { weights: liquidityWeights, labels: liquidityLabels },
    volume: { weights: volumeWeights, labels: volumeLabels },
    fees: { weights: feeWeights, labels: feeLabels },
    svl: { weights: svlChart?.series.weights, labels: svlChart?.series.labels },
  };
  const headline = activePoint
    ? { text: formatChartUSD(activePoint.value), caption: formatChartDate(activePoint.date) }
    : { text: formatPoolAmount(latest[activeTab].value), caption: latest[activeTab].caption };

  useEffect(() => {
    if (!activePoint) {
      setAnnouncement("");
      return;
    }
    const timer = setTimeout(
      () => setAnnouncement(describeChartPoint(CHART_METRIC_LABELS[activeTab], activePoint.date, activePoint.value)),
      ANNOUNCE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [activePoint, activeTab]);
  const { weights: chartWeights, labels: chartLabels } = series[activeTab];

  const selectTab = (tab: ChartMetric) => {
    setActivePoint(null);
    setActiveTab(tab);
    setAdding(false);
  };
  const metricTabClass = (tab: ChartMetric) => `${METRIC_TAB} ${!adding && activeTab === tab ? "bg-accent font-bold text-white" : "text-primary hover:bg-navy/50 hover:text-white"}`;

  return (
    <div
      ref={cardRef}
      id={hasAddLiquidity ? ADD_LIQUIDITY_HASH.slice(1) : undefined}
      className="mx-auto w-full scroll-mt-4 shadow-xl border border-gray-900/40 shadow-[#10124333] bg-linear-to-r from-[#0F1041B2]/70 to-[#2F53A0CC]/80 rounded-2xl p-4 h-full flex flex-col gap-8"
    >
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div className="bg-black/20 w-fit flex rounded-md">
          <button
            onClick={() => selectTab("liquidity")}
            aria-pressed={!adding && activeTab === "liquidity"}
            className={metricTabClass("liquidity")}
          >
            <p className="text-sm">TVL</p>

          </button>
          {volumeWeights && volumeWeights.length > 0 && (
            <button
              onClick={() => selectTab("volume")}
            aria-pressed={!adding && activeTab === "volume"}
            className={metricTabClass("volume")}
            >
              <p className="text-sm">Daily Volume</p>
            </button>
          )}
          {hasSvl && (
            <button
              onClick={() => selectTab("svl")}
              aria-pressed={!adding && activeTab === "svl"}
              className={metricTabClass("svl")}
            >
              <p className="text-sm">SVL</p>
            </button>
          )}
          {feeWeights && feeWeights.length > 0 && (
            <button
              onClick={() => selectTab("fees")}
            aria-pressed={!adding && activeTab === "fees"}
            className={metricTabClass("fees")}
            >
              <p className="text-sm">Daily Fees</p>

            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
        {!adding && (
        <select
          value={selectedDays}
          onChange={(e) => {
            setActivePoint(null);
            setSelectedDays(Number(e.target.value));
          }}
          className="select-chevron w-fit rounded-lg border border-accent bg-black/20 py-1 pl-3 text-sm text-white transition-colors hover:border-accent-light hover:bg-navy/50"
        >
          <option value={90}>Last 90 days </option>
          <option value={30}>Last 30 days </option>
        </select>
        )}
        {hasAddLiquidity && (
          <button type="button" aria-pressed={adding} onClick={() => setAdding(true)} className={`${ADD_TAB} ${adding ? "ring-2 ring-white" : ""}`}>
            <span aria-hidden="true" className="text-lg leading-none">+</span>
            Add liquidity
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">Earn TELx</span>
          </button>
        )}
        </div>
      </div>
      {adding ? (
        addLiquidity
      ) : (
      <>
      <div>
        <p className="pt-1 text-left text-3xl font-[500px] text-white">{headline.text}</p>
        <p className="text-primary min-h-5 text-sm">{headline.caption}</p>
        <p className="sr-only" role="status">
          {announcement}
        </p>
      </div>
      <div>
        {chartWeights && chartWeights.length > 0 && chartLabels && chartLabels.length > 0 ? (
          <PoolChart
            weights={chartWeights}
            labels={chartLabels}
            metricLabel={CHART_METRIC_LABELS[activeTab]}
            selectedDays={selectedDays}
            onActivePointChange={setActivePoint}
            overlay={activeTab === "liquidity" ? svlChart?.overlay : undefined}
            estimatedDates={activeTab === "liquidity" || activeTab === "svl" ? svlChart?.estimated : undefined}
            estimateSubject="SVL"
          />
        ) : (
          noHistoricalData
        )}
      </div>
      </>
      )}
    </div>
  );
};

export default ChartTabs;
