import React from "react";
import { shortenAddress } from "@/helpers/shortenAddress";
import WeightedAsset from "./WeightedAsset";
import ReturnAsset from "./ReturnAsset";
import Link from "next/link";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import PoolSnapshotAssets from "../pool/PoolSnapshotAssets";
import { getPoolPath } from "@/lib/contracts";

export type AssetType = {
  ticker: string;
  weight: number;
};

export default function LabelPoolRow({
  contractData,
  borderTop = true,
  borderBottom = true,
}: {
  contractData: ProtocolsContractData;
  borderTop?: boolean;
  borderBottom?: boolean;
}) {
  const { poolContractAddress, assets, blockchain, protocol } = contractData;

  const borderClasses = ` ${borderTop ? "border-white/20 border-t-[0.60px]" : "border-t-0"
    } ${borderBottom ? "border-white/20 border-b-[0.60px]" : "border-b-0"}`;

  return (
    <div
      className={`flex flex-row justify-between items-center py-4 ${borderClasses} text-primary`}
    >
      <PoolSnapshotAssets contractData={contractData} />
      <div className="flex flex-col items-end">
        <Link href={getPoolPath(poolContractAddress, blockchain, protocol)}>
          <span className="text-base text-blue-700 hover:text-blue-800 cursor-pointer">
            {shortenAddress(poolContractAddress)}
          </span>
        </Link>
      </div>
    </div>
  );
}
