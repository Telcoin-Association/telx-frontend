import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "@/components/common/LabelValueRow";
import ContractReward from "../contract/ContractReward";
import RewardsGrid from "../common/RewardsGrid";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";
import { paysLegacyTelRewards } from "@/lib/tokens";

export default function UnclaimedRewardsDeprecated({
  contractData,
}: {
  contractData: ProtocolsContractData;
}) {
  const rewards = contractData?.user?.deprecated?.rewards;

  return (
    rewards && (
      <LabelValueRow
        label="Your Unclaimed Rewards"
        mode="light"
        value={
          <RewardsGrid>
            {rewards.map((asset: Reward, i: number) => {
              const { unclaimed, ticker } = asset;
              return (
                <ContractReward
                  key={i}
                  amount={unclaimed}
                  ticker={ticker}
                  includeConversion={true}
                  amountToFixed={2}
                  legacy={paysLegacyTelRewards(contractData?.poolContractAddress)}
                />
              );
            })}
          </RewardsGrid>
        }
      />
    )
  );
}
