import React from "react";
import LabelValueRow from "./LabelValueRow";
import { formatProtocol } from "@/helpers/formatProtocol";
import { ProtocolsContractData } from "@/web3/getContracts/shared";

export default function LabelViewPoolRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { addLiquidityLink, protocol, blockchain, poolContractAddress } = contractData;
  const helpText = `Use this link to view the pool on the ${formatProtocol(protocol)}.`;

  return addLiquidityLink ? (
    <LabelValueRow
      label="View pool"
      helpText={helpText}
      value={
        <a
          href={`https://app.uniswap.org/explore/pools/${blockchain}/${poolContractAddress}`}
          target="_blank"
          rel="noreferrer"
          className="text-blue-700 hover:text-burple-600 font-normal cursor-pointer"
        >
          On {formatProtocol(protocol)}
        </a>
      }
    />
  ) : (
    <></>
  );
}



