"use client";

import React, { useState } from "react";
import PoolChart, { ChartPoint } from "./PoolChart";
import { CHART_METRIC_LABELS, ChartMetric, formatChartDate } from "./chartFormat";
import { formatPoolAmount } from "@/helpers/formatPoolAmount";

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
}

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
}) => {

  const [selectedDays, setSelectedDays] = useState(90);
  const [activeTab, setActiveTab] = useState<ChartMetric>("liquidity");
  // The bar under the pointer, keyboard focus or finger; null shows the latest value.
  const [activePoint, setActivePoint] = useState<ChartPoint | null>(null);

  const latest: Record<ChartMetric, { value?: number | null; caption: string }> = {
    liquidity: { value: totalLiquidity, caption: "Past day" },
    volume: { value: dailyVolume, caption: "" },
    fees: { value: dailyFees, caption: "" },
  };
  const series: Record<ChartMetric, { weights?: number[]; labels?: string[] }> = {
    liquidity: { weights: liquidityWeights, labels: liquidityLabels },
    volume: { weights: volumeWeights, labels: volumeLabels },
    fees: { weights: feeWeights, labels: feeLabels },
  };
  const headline = activePoint ? { value: activePoint.value, caption: formatChartDate(activePoint.date) } : latest[activeTab];
  const { weights: chartWeights, labels: chartLabels } = series[activeTab];

  const selectTab = (tab: ChartMetric) => {
    setActivePoint(null);
    setActiveTab(tab);
  };

  return (
    <div className="mx-auto w-full shadow-xl border border-gray-900/40 shadow-[#10124333] bg-linear-to-r from-[#0F1041B2]/70 to-[#2F53A0CC]/80 rounded-2xl p-4 h-full flex flex-col gap-8">
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div className="bg-black/20 w-fit flex rounded-md">
          <button
            onClick={() => selectTab("liquidity")}
            className={`relative py-2 px-4 cursor-pointer rounded-md ${activeTab === "liquidity"
              ? "bg-[#4967FF] font-bold text-white"
              : "text-primary"
              }`}
          >
            <p className="text-sm">TVL</p>

          </button>
          {volumeWeights && volumeWeights.length > 0 && (
            <button
              onClick={() => selectTab("volume")}
              className={`relative py-2 px-4 cursor-pointer rounded-md ${activeTab === "volume"
                ? "bg-[#4967FF] font-bold text-white"
                : "text-primary"
                }`}
            >
              <p className="text-sm">Daily Volume</p>
            </button>
          )}
          {feeWeights && feeWeights.length > 0 && (
            <button
              onClick={() => selectTab("fees")}
              className={`relative py-2 px-4 cursor-pointer rounded-md ${activeTab === "fees"
                ? "bg-[#4967FF] font-bold text-white"
                : "text-primary"
                }`}
            >
              <p className="text-sm">Daily Fees</p>

            </button>
          )}
        </div>
        <select
          value={selectedDays}
          onChange={(e) => {
            setActivePoint(null);
            setSelectedDays(Number(e.target.value));
          }}
          className="rounded-lg border border-[#4967FF] py-1 pl-3 pr-8 text-white outline-hidden w-fit text-sm bg-black/20"
          style={{
            backgroundImage: `url('data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%234967FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M6 9l6 6 6-6"%3E%3C/path%3E%3C/svg%3E')`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right .4rem center",
            backgroundSize: "1.5rem",
            appearance: "none",
          }}
        >
          <option value={90}>Last 90 days </option>
          <option value={30}>Last 30 days </option>
        </select>
      </div>
      <div aria-live="polite">
        <p className="pt-1 text-left text-3xl font-[500px] text-white">{formatPoolAmount(headline.value)}</p>
        <p className="text-primary min-h-5 text-sm">{headline.caption}</p>
      </div>
      <div>
        {chartWeights && chartWeights.length > 0 && chartLabels && chartLabels.length > 0 ? (
          <PoolChart
            weights={chartWeights}
            labels={chartLabels}
            metricLabel={CHART_METRIC_LABELS[activeTab]}
            selectedDays={selectedDays}
            onActivePointChange={setActivePoint}
          />
        ) : (
          noHistoricalData
        )}
      </div>
    </div>
  );
};

export default ChartTabs;
