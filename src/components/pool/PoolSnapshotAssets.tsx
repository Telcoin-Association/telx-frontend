import React from "react";
import PoolWeightChip from "@/components/pool/PoolWeightChip";
import { ProtocolsContractData } from "@/web3/getContracts/shared";

export type Asset = {
  ticker: string;
  weight: number;
};

/**
 * In list rows each chip gets the same minimum width from `lg` up, so the second token starts at the same x in
 * every row whatever the first symbol's length. Below `lg` the chips stack, which aligns them already. The inline
 * (`flex`) heading keeps natural widths.
 */
export const ALIGNED_CHIP_CLASS = "lg:min-w-[7.5rem]";

export default function PoolSnapshotAssets({ contractData, assets, flex }: { contractData?: ProtocolsContractData; assets?: any, flex?: boolean }) {
  const _assets = assets ? assets : contractData?.assets;
  return (
    <div className={`flex ${flex ? "" : "flex-col"}  lg:flex-row lg:items-center gap-2`}>
      {_assets?.map((asset: Asset, i: string) => {
        return <PoolWeightChip asset={asset} key={i} className={flex ? undefined : ALIGNED_CHIP_CLASS} />;
      })}
    </div>
  );
}
