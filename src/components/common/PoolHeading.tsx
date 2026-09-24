import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import PoolSnapshotAssets from "../pool/PoolSnapshotAssets";
import ChainLogo from "@/components/common/ChainLogo"
import LabelAddLiquidity from "./LabelAddLiquidity";
import Button from "./Button";
import ExtrnalLinkIcon from "../../../public/icons/ExternalLinkIconWhite.svg"

const SHOW_ESSENTIAL_GUIDE_BUTTON = false; // Temporarily hidden; content at content/about/TELx-liquidity-mining-essential-guide-for-lps.md is kept.

export default function PoolHeading({
  contractData,
}: {
  contractData: ProtocolsContractData;
}) {

  return (
    <div className="flex flex-col md:flex-row w-full gap-4 justify-between px-4 md:px-0">
      <div className=" flex gap-4">
        <div className="flex items-center">
          <ChainLogo chain={contractData?.blockchain} size={25} />
        </div>
        <PoolSnapshotAssets flex contractData={contractData} />
      </div>
      <div className="flex gap-2">
        {SHOW_ESSENTIAL_GUIDE_BUTTON && contractData.protocol === "uniswap" &&
          <Button linkText={"Essential Guide for LPs"} external rightIcon={<ExtrnalLinkIcon height={20} width={20} />} linkUrl="/about/telx-liquidity-mining-essential-guide-for-lps" type="secondary" />
        }
        <LabelAddLiquidity contractData={contractData} />
      </div>
    </div>
  );
}
