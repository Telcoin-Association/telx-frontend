import React from "react";
import { formatProtocol } from "@/helpers/formatProtocol";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import Link from "next/link";
import HelpTip from "./HelpTip";
import ExtrnalLinkIcon from "../../../public/icons/ExternalLinkIconWhite.svg"

export default function LabelAddLiquidity({ contractData }: { contractData: ProtocolsContractData }) {
  const { addLiquidityLink, protocol } = contractData;
  const helpText = "Use this link to provide liquidity and receive an NFT position. Subscribe the position on TELx to start earning TEL rewards.";

  return addLiquidityLink ? (
    <div className="flex items-center gap-3 w-fit">
      <Link href={addLiquidityLink} target="_blank" rel="noreferrer" className="w-full text-white py-3 px-4 font-bold bg-ocean-gradient flex gap-1 items-center text-sm text-center rounded-lg hover-lift cursor-pointer duration-200">
        Add Liquidity On {formatProtocol(protocol)}
        <ExtrnalLinkIcon height={20} width={20} />
      </Link>
      <HelpTip text={helpText} label="About adding liquidity" />
    </div>
  ) : (
    <></>
  );
}
