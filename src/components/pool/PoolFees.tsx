import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";

export default function PoolFees({ contractData }: { contractData: ProtocolsContractData }) {
  const { fees24hr } = contractData;
  return (
    <div className="flex flex-col items-end text-white">
      {fees24hr == null || Number.isNaN(fees24hr) ? (
        <p className="text-white text-sm">Unavailable</p>
      ) : (
        <p className="text-sm text-white">${stringNumbertoUSD(fees24hr)}</p>
      )}
    </div>
  );
}
