import React from "react";
import LabelValueRow from "./LabelValueRow";
import { formatPoolAmount } from "@/helpers/formatPoolAmount";

//types
import { ProtocolsContractData } from "../../web3/getContracts/shared";

export default function LabelFeesRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { fees24hr, protocol } = contractData;
  const helpText = "The fees paid by traders in the last 24 hours.";

  return <LabelValueRow label="Fees (24hr)" helpText={helpText} value={<p>{formatPoolAmount(fees24hr, protocol)}</p>} />;
}
