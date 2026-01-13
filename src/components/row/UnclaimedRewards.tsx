import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import LabelValueRow from "@/components/common/LabelValueRow";
import CardRewardsUnclaimed from "@/components/Portfolio/CardRewardsUnclaimed";

export default function UnclaimedRewards({ contractData }: { contractData: ProtocolsContractData | undefined }) {

  if (!contractData?.rewards || !contractData?.rewards[0].amount || !contractData?.stakeContractAddress) return null;

  return (
    <div className="">
      <LabelValueRow
        label="Your Unclaimed Rewards"
        value={<CardRewardsUnclaimed rewards={contractData?.rewards} rewardsInterval={contractData?.rewardsInterval} protocol={contractData?.protocol} stakeAddress={contractData?.stakeContractAddress} />}
      />
    </div>
  );
}
