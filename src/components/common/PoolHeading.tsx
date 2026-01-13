import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import PoolSnapshotAssets from "../pool/PoolSnapshotAssets";
import ChainLogo from "@/components/common/ChainLogo"
import LabelAddLiquidity from "./LabelAddLiquidity";

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
      <LabelAddLiquidity contractData={contractData} />
    </div>
  );
}
