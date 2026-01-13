"use client";

import React from "react";
import formatNumberToCurrencyString from "../../helpers/formatNumberToCurrencyString";
import LoadingAnimation from "../common/LoadingAnimationCircle";

export interface PoolsHeaderStatsProps {
  totalLiquidity: number | null;
  stakedLiquidity: number | null;
  totalVolume: number | null;
  totalFees: number | null;
  type?: string;
}

interface StatCardProps {
  title: string;
  value: number | null;
  type?: string;
}

const StatCard = ({ title, value, type }: StatCardProps) => {
  const formattedValue = value !== null && value !== 0 ? formatNumberToCurrencyString(value) : <LoadingAnimation size={24} />;

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg bg-black/20 px-4 py-3">
      <div>
        <h4 className="text-sm font-medium text-primary">{title}</h4>
      </div>
      <div>
        <div className="text-white-100 text-base">{formattedValue}</div>
      </div>
    </div>
  );
};

const PoolsHeaderStats = ({ totalLiquidity, stakedLiquidity, totalVolume, totalFees, type }: PoolsHeaderStatsProps) => {
  const stats = [
    { title: "TVL", value: totalLiquidity },
    { title: "Staked", value: stakedLiquidity },
    { title: "Volume (24hr)", value: totalVolume },
    { title: "Fees (24hr)", value: totalFees },
  ];

  const getLayoutContainer = () => {
    return (
      <div className="grid grid-cols-2 mx-auto w-auto gap-4 md:grid-cols-4">
        {stats.map(stat => (
          <StatCard key={stat.title} title={stat.title} value={stat.value} type={type} />
        ))}
      </div>
    );
  };

  return getLayoutContainer();
};

export default PoolsHeaderStats;
