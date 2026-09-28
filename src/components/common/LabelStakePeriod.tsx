import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";

export default function LabelStakePeriod({
  contractData,
  defaultRewards,
  type = "default",
  rewardsInterval,
}: {
  contractData?: ProtocolsContractData;
  defaultRewards: any;
  type?: "default" | "generalized";
  rewardsInterval?: string;
}) {
  const stakingPeriod = type === "generalized" ? rewardsInterval : contractData?.stakingPeriod;
  const defaultPeriod = defaultRewards?.staking_period;

  return <>
    {contractData?.protocol === "uniswap" ? <LabelValueRow label="Reward Distribution" value={<p>3x/day</p>} /> : <LabelValueRow label="Staking Period" value={<p>{stakingPeriod ? stakingPeriod : defaultPeriod}</p>} />}
      </>
}

