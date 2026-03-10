import React from "react";
import PoolWeightChip from "@/components/pool/PoolWeightChip";
import { ProtocolsContractData } from "@/web3/getContracts/shared";

export type Asset = {
  ticker: string;
  weight: number;
};

export default function PoolSnapshotAssets({ contractData, assets, flex }: { contractData?: ProtocolsContractData; assets?: any, flex?: boolean }) {
  const _assets = assets ? assets : contractData?.assets;
  return (
    <div className={`flex ${flex ? "" : "flex-col"}  lg:flex-row lg:items-center gap-2`}>
      {_assets?.map((asset: Asset, i: string) => {
        return <PoolWeightChip asset={asset} key={i} />;
      })}
    </div>
  );
}
