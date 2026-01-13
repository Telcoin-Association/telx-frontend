"use client";

import React from "react";
import PoolsHeaderStats from "../stats/PoolsHeaderStats";
import { useAppSelector } from "@/redux/hooks";
import { stakedLiquiditySelector, totalFeesSelector, totalLiquiditySelector, totalVolumeSelector } from "@/redux/slices/contractsSlice";

export default function StatsCards() {
  const totalLiquidity = useAppSelector(totalLiquiditySelector);
  const stakedLiquidity = useAppSelector(stakedLiquiditySelector);
  const totalVolume = useAppSelector(totalVolumeSelector);
  const totalFee = useAppSelector(totalFeesSelector);

  const liquidityData = {
    totalLiquidity: totalLiquidity,
    stakedLiquidity: stakedLiquidity,
    totalVolume: totalVolume,
    totalFees: totalFee,
  };
  return <>{liquidityData && <PoolsHeaderStats {...liquidityData} />}</>;
}
