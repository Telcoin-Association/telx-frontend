import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import { stringNumbertoUSD } from "@/helpers/returnNumber";
import LabelValueRow from "./LabelValueRow";

export default function LabelVolumeRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { dailyVolumeUSD } = contractData;
  const helpText = "The USD Volume of pool trades in the last 24 hours.";

  return dailyVolumeUSD > 0 ? (
    <LabelValueRow label="Volume (24hr)" helpText={helpText} value={<p>${dailyVolumeUSD ? stringNumbertoUSD(dailyVolumeUSD) : 0}</p>} />
  ) : (
    <></>
  );
}
