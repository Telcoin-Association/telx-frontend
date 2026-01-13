import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";

export default function PoolVolume({ contractData }: { contractData: ProtocolsContractData }) {
  const { dailyVolumeUSD } = contractData;
  return (
    <div className="flex flex-col items-end">
      {dailyVolumeUSD && dailyVolumeUSD > 0 ? (
        <p className="text-sm text-white">${stringNumbertoUSD(dailyVolumeUSD)}</p>
      ) : (
        <p className="text-white  text-sm">Unavailable</p>
      )}
    </div>
  );
}
