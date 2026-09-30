import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import ContractReward from "@/components/contract/ContractReward";
import HoverTooltip from "@/components/common/HoverTooltip";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";
import { getRewardsStartLabel } from "@/helpers/getRewardsById";
import { numberToDecimalFixed } from "@/helpers/returnNumber";
import { SUBSCRIBED_APR_HELP, formatApr, formatCampaignDate, formatDailyRewards, getMerklRewards } from "@/helpers/poolRewardsDisplay";
import { paysLegacyTelRewards } from "@/lib/tokens";
import { useNow } from "@/hooks/useNow";

// Rewards column of the pool lists. A live Merkl campaign leads with its APR and keeps the weekly token
// amount as a second line; a scheduled one shows its start date and an ended one "Ended". Without Merkl
// data (other protocols, or rewards not loaded) the column shows the configured weekly rewards.
export default function PoolRewards({ contractData }: { contractData: ProtocolsContractData }) {
  const { rewards, blockchain, deprecated } = contractData;
  const merkl = getMerklRewards(contractData, useNow());
  const startLabel = getRewardsStartLabel(blockchain, deprecated);

  if (merkl.status === "LIVE" && merkl.apr != null) {
    const details = [
      SUBSCRIBED_APR_HELP,
      merkl.dailyRewards != null ? `Rewards: ${formatDailyRewards(merkl.dailyRewards)}` : null,
      merkl.campaignEnd != null ? `Campaign ends ${formatCampaignDate(merkl.campaignEnd)} (UTC)` : null,
    ].filter((line): line is string => line !== null);
    const apr = <span className="text-sm font-bold text-white">{formatApr(merkl.apr)}</span>;

    return (
      <div className="flex flex-col items-end justify-end text-end">
        <HoverTooltip
          content={details.map(line => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        >
          <span className="cursor-help underline decoration-white/30 decoration-dotted underline-offset-4">{apr}</span>
        </HoverTooltip>
        {rewards?.map((reward: Reward, i: number) => (
          <p key={i} className="text-xs text-primary">
            {numberToDecimalFixed(reward.amount, 0)} {reward.ticker} / week
          </p>
        ))}
      </div>
    );
  }

  if (merkl.status === "SOON" || merkl.status === "PAST") {
    const label =
      merkl.status === "PAST"
        ? "Ended"
        : merkl.campaignStart != null
          ? `Starting ${formatCampaignDate(merkl.campaignStart)}`
          : (startLabel ?? "Starting soon");
    return (
      <div className="flex flex-col items-end justify-end text-end">
        <p className="text-sm font-bold text-white">{label}</p>
      </div>
    );
  }

  // A live campaign without an APR has started, so the configured start date no longer applies.
  return (
    <div className="flex flex-col items-end justify-end text-end">
      {startLabel && merkl.status !== "LIVE" ? (
        <p className="text-sm font-bold text-white">{startLabel}</p>
      ) : (
        rewards &&
        rewards.map((reward: Reward, i: number) => {
          const { amount, ticker } = reward;
          return (
            <ContractReward
              amount={amount}
              ticker={ticker}
              includeConversion={true}
              key={i}
              legacy={paysLegacyTelRewards(contractData.poolContractAddress)}
            />
          );
        })
      )}
    </div>
  );
}
