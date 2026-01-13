import React from "react";
import ReturnStatus from "../common/ReturnStatus";
import ContractReward from "../contract/ContractReward";
import LabelProtocolRow from "../common/LabelProtocolRow";
import LabelValueRow from "../common/LabelValueRow";
import LabelStakePeriod from "../common/LabelStakePeriod";
import RichText from "../common/RichText";
import GeneralizedPoolsFull from "./GeneralizedPoolsFull";

//types
import { PoolGeneralized as PoolGeneralizedProps } from "@/types/PoolGeneralized";
import { DefaultRewardsInfo as DefaultRewardsInfoProps } from "@/types/DefaultRewardsInfo";

export interface GeneralizedIncentivesProps {
  description?: string;
  contracts: {
    data: PoolGeneralizedProps[];
  };
  defaultRewards: DefaultRewardsInfoProps[];
  rewards: any;
}

export default function GeneralizedIncentives(props: GeneralizedIncentivesProps) {
  const { contracts, description, defaultRewards, rewards } = props;

  let rewardsAmount = 0;
  if (rewards.data && rewards.data[0] && rewards.data[0].attributes.name) {
    const amountStr = rewards.data[0].attributes.name.split(" ")[1];
    rewardsAmount = parseInt(amountStr, 10);
  }

  let stakingPeriod: string | undefined;
  let rewardsInterval: string | undefined;
  if (defaultRewards && defaultRewards[0] && defaultRewards[0].attributes) {
    stakingPeriod = defaultRewards[0].attributes.staking_period;
    rewardsInterval = defaultRewards[0].attributes.rewards_interval;
  }

  return (
    <div className="mx-auto grid grid-cols-1  xl:grid-cols-2">
      <div className="min-h-[700px] bg-white-100 px-4 py-12 md:px-10 2xl:py-16">
        <section className="mx-auto max-w-xl">
          <div className="mx-auto flex flex-col justify-center text-center">
            <LabelProtocolRow protocol="balancer" />
            <LabelValueRow label="Status" value={<ReturnStatus status="deprecated" />} />
            <LabelStakePeriod defaultRewards={defaultRewards} rewardsInterval={stakingPeriod} type="generalized" />

            <div className="flex flex-row justify-between border-t-[0.8px] border-gray-400 py-5">
              <div className="text-primary">Rewards / {rewardsInterval}</div>
              <div>
                <ContractReward amount={rewardsAmount} ticker="TEL" includeConversion={true} />
              </div>
            </div>
          </div>

          <section className="py-5 text-primary">
            <RichText markdown={description} />
          </section>
        </section>
      </div>
      <div className="bg-gray-200 p-4 pb-12 pt-8 md:p-10 2xl:py-16">
        <section className="mx-auto max-w-xl">
          {" "}
          <GeneralizedPoolsFull contracts={contracts} />{" "}
        </section>
      </div>
    </div>
  );
}
