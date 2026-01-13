import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import ContractReward from "@/components/contract/ContractReward";
import { Reward } from "@/web3/getContracts/quickswap/getStakeInfo";

export default function PoolRewards({
  contractData,
}: {
  contractData: ProtocolsContractData;
}) {
  const { rewards } = contractData;

  return (
    <div className="flex flex-col items-end justify-end text-end">
      {rewards &&
        rewards.map((reward: Reward, i: number) => {
          const { amount, ticker } = reward;
          return (
            <ContractReward
              amount={amount}
              ticker={ticker}
              includeConversion={true}
              key={i}
            />
          );
        })}
    </div>
  );
}
