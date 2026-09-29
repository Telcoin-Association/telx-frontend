import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";
import formatShortDate from "@/helpers/formatShortDate";
import HoverTooltip from "@/components/common/HoverTooltip";

export default function PoolVolume({ contractData }: { contractData: ProtocolsContractData }) {
  const { dailyVolumeUSD, lastSwapAt } = contractData;
  return (
    <div className="flex flex-col items-end">
      {dailyVolumeUSD == null || Number.isNaN(dailyVolumeUSD) ? (
        <p className="text-white  text-sm">Unavailable</p>
      ) : dailyVolumeUSD === 0 ? (
        // A zero reads as a real amount; why it is zero is on hover, so the row keeps one line like the others.
        <HoverTooltip content={lastSwapAt ? `No swaps since ${formatShortDate(lastSwapAt)}` : "No swaps in the last 24h"}>
          <span className="cursor-help text-sm text-white underline decoration-white/30 decoration-dotted underline-offset-4">$0.00</span>
        </HoverTooltip>
      ) : (
        <p className="text-sm text-white">${stringNumbertoUSD(dailyVolumeUSD)}</p>
      )}
    </div>
  );
}
