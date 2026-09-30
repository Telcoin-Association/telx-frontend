import React from "react";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";
import formatShortDate from "@/helpers/formatShortDate";

/** Why a pool's 24h volume is zero: the last swap's date when known. */
export function noSwapsNote(lastSwapAt: number | null | undefined): string {
  return lastSwapAt ? `No swaps since ${formatShortDate(lastSwapAt)}` : "No swaps in the last 24h";
}

export default function PoolVolume({ contractData }: { contractData: ProtocolsContractData }) {
  const { dailyVolumeUSD, lastSwapAt } = contractData;
  return (
    <div className="flex flex-col items-end">
      {dailyVolumeUSD == null || Number.isNaN(dailyVolumeUSD) ? (
        <p className="text-white  text-sm">Unavailable</p>
      ) : dailyVolumeUSD === 0 ? (
        // A zero reads as a real amount, with why it is zero as a second line, readable by touch, keyboard
        // and screen reader alike inside the row link.
        <>
          <p className="text-sm text-white">$0.00</p>
          <p className="text-xs text-primary">{noSwapsNote(lastSwapAt)}</p>
        </>
      ) : (
        <p className="text-sm text-white">${stringNumbertoUSD(dailyVolumeUSD)}</p>
      )}
    </div>
  );
}
