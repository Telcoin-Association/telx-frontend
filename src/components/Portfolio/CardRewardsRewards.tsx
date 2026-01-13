import React from "react";
import { DefaultRewards } from "../../types/DefaultRewards";
import { Reward } from "../../web3/getContracts/quickswap/getStakeInfo";
import ContractReward from "../contract/ContractReward";
import RewardsGrid from "../common/RewardsGrid";

interface CardRewardsRewardsProps {
  rewards: Reward[];
  rewardsInterval: string;
  protocol: string;
  stakeAddress: string;
  defaultRewards: DefaultRewards;
}

const CardRewardsRewards: any = (props: CardRewardsRewardsProps) => {
  const { rewards } = props;

  return (
    rewards[0].weeklyUser && (
      <div className="w-full">
        {rewards &&
          rewards.map((reward, i) => {
            const { weeklyUser, ticker } = reward;
            return <ContractReward amount={weeklyUser} ticker={ticker} includeConversion={true} key={i} flex />;
          })}
      </div>
    )
  );
};

export default CardRewardsRewards;
