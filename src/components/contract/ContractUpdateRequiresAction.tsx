import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import { Alert as AlertIcon } from "@transferwise/icons";

export default function ContractUpdateRequiresAction({
  contractData,
}: {
  contractData: ProtocolsContractData;
}) {
  const { user, protocol, deprecated } = contractData;
  const userDeprecated = user?.deprecated;
  let stakedLPTDeprecated;
  if (userDeprecated) {
    stakedLPTDeprecated = Number(userDeprecated.stakedLPT);
  }

  return stakedLPTDeprecated || deprecated && protocol === "uniswap" ? (
    <div className="flex flex-row text-status-inProgress items-center text-sm">
      <AlertIcon />
      <p>Update requires action</p>
    </div>
  ) : null;
}
