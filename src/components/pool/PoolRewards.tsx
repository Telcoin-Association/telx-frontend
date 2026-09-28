import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import ContractReward from "@/components/contract/ContractReward";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";
import { getRewardsStartLabel } from "@/helpers/getRewardsById";
import { paysLegacyTelRewards } from "@/lib/tokens";

export default function PoolRewards({
  contractData,
}: {
  contractData: ProtocolsContractData;
}) {
  const { rewards, blockchain, deprecated } = contractData;
  const startLabel = getRewardsStartLabel(blockchain, deprecated);

  return (
    <div className="flex flex-col items-end justify-end text-end">
      {startLabel ? (
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
