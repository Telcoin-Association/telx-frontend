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
import { SUBSCRIBED_APR_HELP, formatAprPercent, formatCampaignWindow, formatDailyRewards, getMerklRewards } from "@/helpers/poolRewardsDisplay";
import { useNow } from "@/hooks/useNow";

// Suffix of the campaign window line, so a window that is not paying out now does not read as current.
const CAMPAIGN_STATE_SUFFIX = { LIVE: "", SOON: " (not started)", PAST: " (ended)" } as const;


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

  // Merkl campaign details: the APR while a campaign is live, and the campaign window whenever it is known.
  const merkl = getMerklRewards(contractData, useNow());
  const apr = merkl.status === "LIVE" ? merkl.apr : null;
  const campaignWindow = merkl.status ? formatCampaignWindow(merkl.campaignStart, merkl.campaignEnd) : null;

  return (
    <div className="flex flex-col gap-3 py-3 px-4 text-primary bg-black/20 shadow rounded-2xl">
      <div className="flex flex-row justify-between items-end">
        <div>
          <h4 className="text-xs text-primary">{contractData?.protocol === "uniswap" ? "Rewards / 7 days" : `Rewards / ${rewardsInterval ? rewardsInterval : defaultInterval}`}</h4>
          <div>
            {isLoading ? <LoadingAnimation size={24} /> : memoizedRewards}
          </div>
        </div>
        {/* Right Side - Currency */}
        <div>{memoizedCurrencyRewards}</div>
      </div>
      {(apr != null || campaignWindow) && (
        <div className="flex flex-row flex-wrap justify-between items-end gap-2 border-t border-white/10 pt-3">
          {apr != null && (
            <div>
              <h4 className="text-xs text-primary" title={SUBSCRIBED_APR_HELP}>Subscribed APR</h4>
              <p className="text-base text-white">{formatAprPercent(apr)}</p>
              {merkl.dailyRewards != null && <p className="text-xs text-primary">{formatDailyRewards(merkl.dailyRewards)}</p>}
            </div>
          )}
          {campaignWindow && merkl.status && (
            <div className="ml-auto text-end">
              <h4 className="text-xs text-primary">Campaign</h4>
              <p className="text-sm text-white">
                {campaignWindow}
                {CAMPAIGN_STATE_SUFFIX[merkl.status]}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
