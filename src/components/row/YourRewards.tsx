import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import LabelValueRow from "@/components/common/LabelValueRow";
import CardRewardsRewards from "@/components/Portfolio/CardRewardsRewards";

export default function YourDeposits({ contractData, defaultRewards }: { contractData: ProtocolsContractData; defaultRewards: any }) {
  if (!contractData?.user || !contractData.rewards || contractData.rewardsInterval || contractData.protocol || contractData.stakeContractAddress) {
    return null;
  }
  const { user, rewards, rewardsInterval, protocol, stakeContractAddress } = contractData;
  const defaultInterval = defaultRewards[0]?.attributes?.rewards_interval;
  const { stakedUSD } = user;

  return stakedUSD && stakedUSD > 0 ? (
    <>
      <LabelValueRow
        label={`Your Rewards / ${rewardsInterval ? rewardsInterval : defaultInterval}`}
        value={
          rewards &&
          rewards[0].amount && (
            <CardRewardsRewards
              rewards={rewards}
              rewardsInterval={rewardsInterval}
              protocol={protocol}
              stakeAddress={stakeContractAddress}
              defaultRewards={defaultRewards}
            />
          )
        }
      />
    </>
  ) : null;
}

