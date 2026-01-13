import React from "react";
import PoolSnapshotGeneralized from "../pool/PoolSnapshotGeneralized";
import { PoolGeneralized as PoolGeneralizedProps } from "@/types/PoolGeneralized";

interface GeneralizedPoolsProps {
  contracts: PoolGeneralizedProps[];
}

export default function GeneralizedPools(props: GeneralizedPoolsProps) {
  const { contracts } = props;

  return (
    <div className="border rounded-2xl border-white/10 shadow-2xl">
      {contracts?.map((contract, i) => {
        return <PoolSnapshotGeneralized contractData={contract} key={i} isLast={i === contracts?.length - 1} isFirst={i === 0} />;
      })}
    </div>
  );
}
