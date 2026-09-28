import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";
import formatShortDate from "@/helpers/formatShortDate";

export default function PoolVolume({ contractData }: { contractData: ProtocolsContractData }) {
  const { dailyVolumeUSD, lastSwapAt, protocol } = contractData;
  return (
    <div className="flex flex-col items-end">
      {protocol === "dfx" ? (
        <p className="text-white  text-sm">No historical data</p>
      ) : dailyVolumeUSD == null || Number.isNaN(dailyVolumeUSD) ? (
        <p className="text-white  text-sm">Unavailable</p>
      ) : (
        <>
          <p className="text-sm text-white">${stringNumbertoUSD(dailyVolumeUSD)}</p>
          {dailyVolumeUSD === 0 && (
            <p className="text-xs text-primary">{lastSwapAt ? `No swaps since ${formatShortDate(lastSwapAt)}` : "No swaps in the last 24h"}</p>
          )}
        </>
      )}
    </div>
  );
}
