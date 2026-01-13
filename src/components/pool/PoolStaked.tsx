import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";

export default function PoolStaked({ contractData }: { contractData: ProtocolsContractData }) {
  const { stakedLiquidity } = contractData;
  return (
    <div className="flex flex-col items-end text-white">
      {stakedLiquidity ?
        <p className="text-sm text-white">{stringNumbertoUSD(stakedLiquidity)}</p>
        :
        <p className="text-sm text-white">N/A</p>
      }
    </div>
  );
}
