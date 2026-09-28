import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";

export default function PoolTotal({ contractData }: { contractData: ProtocolsContractData }) {
  const { totalLiquidity, protocol } = contractData;
  return (
    <div className="flex flex-col items-end text-white">
      {protocol === "dfx" ? (
        <p className="text-white text-sm">No historical data</p>
      ) : totalLiquidity == null || Number.isNaN(totalLiquidity) ? (
        <p className="text-white text-sm">Unavailable</p>
      ) : (
        <p className="text-sm text-white">${stringNumbertoUSD(totalLiquidity)}</p>
      )}
    </div>
  );
}
