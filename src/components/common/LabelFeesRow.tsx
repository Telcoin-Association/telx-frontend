import React from "react";
import LabelValueRow from "./LabelValueRow";
import { stringNumbertoUSD } from "@/helpers/returnNumber";

//types
import { ProtocolsContractData } from "../../web3/getContracts/shared";

export default function LabelFeesRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { fees24hr } = contractData;
  const helpText = "The fees paid by traders in the last 24 hours.";

  return fees24hr && fees24hr > 0 ? (
    <LabelValueRow label="Fees (24hr)" helpText={helpText} value={<p>${fees24hr ? stringNumbertoUSD(fees24hr) : 0}</p>} />
  ) : (
    <></>
  );
}
