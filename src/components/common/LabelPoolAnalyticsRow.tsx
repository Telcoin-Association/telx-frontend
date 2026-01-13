import React from "react";
import LabelValueRow from "./LabelValueRow";
import { formatProtocol } from "@/helpers/formatProtocol";

//types
import { ProtocolsContractData } from "../../web3/getContracts/shared";

export default function LabelPoolAnalyticsRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { poolAnalyticsLink, protocol } = contractData;

  return poolAnalyticsLink ? (
    <LabelValueRow
      label="View Analytics"
      value={
        <a href={poolAnalyticsLink} target="_blank" rel="noreferrer" className="text-blue-700 hover:text-burple-600 font-normal cursor-pointer">
          On {formatProtocol(protocol)}
        </a>
      }
    />
  ) : (
    <></>
  );
}
