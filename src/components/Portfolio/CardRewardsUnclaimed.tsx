import React from "react";
import { Reward } from "../../web3/getContracts/quickswap/getStakeInfo";
// this specific pool's TEL rewards are airdropped, so we will use this address to hide TEL on the rewards card
import { STAKE_ADDRESS_TEL_DFX } from "@/lib/constants";
import ContractReward from "../contract/ContractReward";
import RewardsGrid from "../common/RewardsGrid";

// @FIXME
interface CardRewardsUnclaimedProps {
  rewards: Reward[];
  rewardsInterval: string;
  protocol: string;
  stakeAddress: string;
}

const CardRewardsUnclaimed: any = (props: CardRewardsUnclaimedProps) => {
  const { rewards, protocol, stakeAddress } = props;
  if (!rewards[0]?.weeklyUser) return null;
  return (
    rewards[0].weeklyUser && (
      <RewardsGrid>
        {rewards &&
          rewards.map((reward, i) => {
            const { unclaimed, ticker } = reward;
            if ((protocol === "dfx" && ticker === "TEL") || (stakeAddress === STAKE_ADDRESS_TEL_DFX && ticker === "TEL")) {
              return null;
            } else {
              return (
                <span key={i}>
                  <ContractReward amount={unclaimed} ticker={ticker} includeConversion={true} flex />
                </span>
              );
            }
          })}
      </RewardsGrid>
    )
  );
};

export default CardRewardsUnclaimed;
