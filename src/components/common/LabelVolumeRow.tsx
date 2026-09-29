import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";
import { formatPoolAmount } from "@/helpers/formatPoolAmount";

export default function LabelVolumeRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { dailyVolumeUSD } = contractData;
  const helpText = "The USD Volume of pool trades in the last 24 hours.";

  return <LabelValueRow label="Volume (24hr)" helpText={helpText} value={<p>{formatPoolAmount(dailyVolumeUSD)}</p>} />;
}
