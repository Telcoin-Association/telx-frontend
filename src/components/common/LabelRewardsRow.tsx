/* eslint-disable react-hooks/exhaustive-deps */
import React, { useMemo } from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";
import { numberToDecimalFixed } from "@/helpers/returnNumber";
import formatNumberToCurrencyString from "@/helpers/formatNumberToCurrencyString";
import { useGetMarketRateQuery } from "@/redux/slices/marketRateSlice";
import LoadingAnimation from "./LoadingAnimationCircle";
import BigNumber from "bignumber.js";
import ReturnAsset from "./ReturnAsset";
import { paysLegacyTelRewards } from "@/lib/tokens";


export default function LabelRewardsRow({
  contractData,
  defaultRewards,
}: {
  contractData: ProtocolsContractData;
  defaultRewards: any;
}) {
  const { rewards, rewardsInterval } = contractData;
  const defaultInterval = defaultRewards?.rewards_interval;
  const { data, isLoading } = useGetMarketRateQuery() as {
    data: any;
    isLoading: boolean;
  };

  //  Render rewards list
  const renderRewards = (showCurrency: boolean) => {
    if (!rewards) return null;

    return rewards.map((reward: Reward, i: number) => {
      const { amount, ticker } = reward;
      const value = BigNumber(amount).multipliedBy(data?.[ticker]?.USD || 0);

      return (
        <div key={i} className={`flex items-center ${!showCurrency ? "gap-1" : ""}`}>
          {!showCurrency && <ReturnAsset ticker={ticker} size={24} legacy={paysLegacyTelRewards(contractData?.poolContractAddress)} />}
          {showCurrency ? <p className="text-xs text-primary">{formatNumberToCurrencyString(value.toNumber())} </p>
            : <p className="text-base text-white">{numberToDecimalFixed(amount, 0)}</p>}
        </div>
      );
    });
  };

  //  Memoized results to prevent unnecessary recalculations
  const memoizedRewards = useMemo(
    () => renderRewards(false), // token rewards
    [rewards, data]            // recalculate if these change
  );

  const memoizedCurrencyRewards = useMemo(
    () => renderRewards(true), // currency rewards
    [rewards, data]            // recalculate if these change
  );

  return (
    <div className="flex flex-row justify-between items-end py-3 px-4 text-primary bg-black/20 shadow rounded-2xl">
      <div>
        <h4 className="text-xs text-primary">{contractData?.protocol === "uniswap" ? "Rewards / 7 days" : `Rewards / ${rewardsInterval ? rewardsInterval : defaultInterval}`}</h4>
        <div>
          {isLoading ? <LoadingAnimation size={24} /> : memoizedRewards}
        </div>
      </div>
      {/* Right Side - Currency */}
      <div>{memoizedCurrencyRewards}</div>
    </div>
  );
}
