import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import ContractUpdateRequiresAction from "../contract/ContractUpdateRequiresAction";
import ReturnStatus from "./ReturnStatus";

export default function StatusAndStartEnd({
  contractData,
}: {
  contractData: ProtocolsContractData;
}) {
  const { deprecated } = contractData;

  return (
    <div className="flex flex-col items-start">
      <ReturnStatus status={deprecated ? "deprecated" : "active"} />
      <ContractUpdateRequiresAction contractData={contractData} />
    </div>
  );
}
