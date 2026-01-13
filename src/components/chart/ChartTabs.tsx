"use client";

import React, { useState } from "react";
import PoolChart from "./PoolChart";

interface ChartTabsProps {
  totalLiquidity: number;
  dailyVolume: number;
  dailyFees?: number;
  liquidityWeights?: number[];
  liquidityLabels?: string[];
  volumeWeights?: number[];
  volumeLabels?: string[];
  feeWeights?: number[];
  feeLabels?: string[];
}

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
  const [activeTab, setActiveTab] = useState<"liquidity" | "volume" | "fees">(
    "liquidity"
  );

  return (
    <div className="mx-auto w-full shadow-xl border border-gray-900/40 shadow-[#10124333] bg-gradient-to-r from-[#0F1041B2]/70 to-[#2F53A0CC]/80 rounded-2xl p-4 h-full flex flex-col gap-8">
      <div className="flex flex-col md:flex-row gap-4 justify-between">
        <div className="bg-black/20 w-fit flex rounded-md">
          <button
            onClick={() => setActiveTab("liquidity")}
            className={`relative py-2 px-4 cursor-pointer rounded-md ${activeTab === "liquidity"
              ? "bg-[#4967FF] font-bold text-white"
              : "text-primary"
              }`}
          >
            <p className="text-sm">TVL</p>

          </button>
          {volumeWeights && volumeWeights.length > 0 && (
            <button
              onClick={() => setActiveTab("volume")}
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
              onClick={() => setActiveTab("fees")}
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
          onChange={(e) => setSelectedDays(Number(e.target.value))}
          className="rounded-lg border-[1px] border-[#4967FF] py-1 pl-3 pr-8 text-white outline-hidden w-fit text-sm bg-black/20"
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
      <div>
        {activeTab === "liquidity" &&
          <div>
            <p className="pt-1 text-left text-3xl font-[500px] text-white ">
              ${totalLiquidity}
            </p>
            <p className="text-primary text-sm ">Past day</p>
          </div>
        }
        {activeTab === "volume" &&
          <div>
            <p className="pt-1 text-left text-3xl font-[500px] text-white">${dailyVolume}</p>
          </div>
        }
        {activeTab === "fees" &&
          <div>
            <p className="pt-1 text-left text-3xl font-[500px] text-white">${dailyFees}</p>
          </div>
        }
      </div>
      <div>
        {activeTab === "liquidity" &&
          <>
            {

              liquidityWeights &&
                liquidityWeights?.length > 0 &&
                liquidityLabels &&
                liquidityLabels?.length > 0 ? (
                <PoolChart
                  weights={liquidityWeights}
                  labels={liquidityLabels}
                  chartLabel="Total Liquidity"
                  selectedDays={selectedDays}
                />
              ) : <h3 className=" text-primary mt-10 text-center ">Chart data is currently unavailable. Please try again later.</h3>
            }
          </>
        }
        {activeTab === "volume" &&
          <>
            {

              volumeWeights &&
                volumeWeights.length > 0 &&
                volumeLabels &&
                volumeLabels.length > 0 ? (
                <PoolChart
                  weights={volumeWeights}
                  labels={volumeLabels}
                  chartLabel="Daily Volume"
                  selectedDays={selectedDays}
                />
              ) : <h3 className=" text-primary mt-10 text-center ">Chart data is currently unavailable. Please try again later.</h3>
            }
          </>
        }
        {activeTab === "fees" &&
          <>
            {


              feeWeights &&
                feeWeights.length > 0 &&
                feeLabels &&
                feeLabels.length > 0 ? (
                <PoolChart
                  weights={feeWeights}
                  labels={feeLabels}
                  chartLabel="Daily Fees"
                  selectedDays={selectedDays}
                />
              ) : <h3 className=" text-primary mt-10 text-center ">Chart data is currently unavailable. Please try again later.</h3>
            }
          </>
        }
      </div>
    </div>
  );
};

export default ChartTabs;
