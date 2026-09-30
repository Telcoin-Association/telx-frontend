import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";
import { formatPoolAmount } from "@/helpers/formatPoolAmount";
import { noSwapsNote } from "@/components/pool/PoolVolume";

export default function LabelVolumeRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { dailyVolumeUSD, lastSwapAt } = contractData;
  const helpText = "The USD Volume of pool trades in the last 24 hours.";
  const value = (
    <>
      <p>{formatPoolAmount(dailyVolumeUSD)}</p>
      {dailyVolumeUSD === 0 && <p className="text-xs text-primary">{noSwapsNote(lastSwapAt)}</p>}
    </>
  );

  return <LabelValueRow label="Volume (24hr)" helpText={helpText} value={value} />;
}
