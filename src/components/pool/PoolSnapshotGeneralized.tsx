import React from "react";
import PoolSnapshotAssets from "@/components/pool/PoolSnapshotAssets";
import Link from "next/link";
import ReturnStatus from "../common/ReturnStatus";
import { ContractAsset } from "@/types/ContractAsset";
import ChainLogo from "../common/ChainLogo";

export default function PoolSnapshotGeneralized({
  contractData,
  isLast,
  isFirst
}: {
  contractData: any;
  isLast: boolean;
  isFirst: boolean;
}) {
  const assetsData = contractData?.attributes?.pool_assets?.data;
  const assets = assetsData.map((asset: ContractAsset) => {
    const [ticker, weight] = asset.attributes.name.split(" ");
    return { ticker, weight };
  });

  return (
    <div>
      <Link href="pools/generalized-incentives">
        {/* displayed on mobiles & tablets */}
        <div className="flex cursor-pointer flex-col items-center xl:hidden">
          <div className="mx-auto flex w-full flex-row items-center justify-between px-4 py-4 text-center">
            <PoolSnapshotAssets assets={assets} />
            <p className="text-primary">Generalized</p>
          </div>
        </div>

        {/* displayed on desktop */}
        <div className={`mx-auto hidden w-full cursor-pointer grid-cols-[3fr_1fr_2fr_2fr_2fr_2fr] items-center justify-between bg-gradient-to-r from-[#0F1041B2]/30 to-[#2F53A0CC]/30 px-4 py-4 backdrop-blur hover:!bg-white/5 xl:grid ${isLast ? "rounded-b-2xl" : ""} ${isFirst ? "rounded-t-2xl" : ""}  `} >
          <PoolSnapshotAssets assets={assets} />
          <div id="protocol-name" className="text-white text-sm">
            Balancer
          </div>
          <div className="flex flex-col items-end">
            <ReturnStatus status="active" />
          </div>
          <p className="text-right text-gray-700 text-xs">Coming Soon</p>
          <p className="text-right text-gray-700 text-xs">Coming Soon</p>
          <p className="text-right text-gray-700 text-xs">Generalized</p>
        </div>
      </Link>
    </div>
  );
}
