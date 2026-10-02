import React from "react";
import Link from "next/link";
import PoolSnapshotAssets from "./PoolSnapshotAssets";
import StatusAndStartEnd from "../common/StatusAndStartEnd";
import PoolTotal from "./PoolTotal";
import PoolSubscribed from "./PoolSubscribed";
import PoolRewards from "./PoolRewards";
import ChainLogo from "@/components/common/ChainLogo";
import PoolFees from "./PoolFees";
import PoolVolume from "./PoolVolume";
import ProtocolVersionLogo from "../common/ProtocolVersionLogo";
import { getPoolPath } from "@/lib/contracts";
import { ALL_POOL_COLUMNS, poolRowGrid, type PoolListColumns } from "@/lib/poolColumns";
import { isNewPool } from "@/lib/newPool";

/** One pool as a table row. `columns` says whether the Status and Protocol columns are shown. */
export default function PoolSnapshot({
  contractData,
  isLast,
  isFirst,
  columns = ALL_POOL_COLUMNS,
}: {
  contractData: any;
  isLast?: boolean;
  isFirst?: boolean;
  columns?: PoolListColumns;
}) {
  const { poolContractAddress, blockchain, protocol, createdAt } = contractData;

  return (
    <div>
      <Link href={getPoolPath(poolContractAddress, blockchain, protocol)}>
        <div
          className={`mx-auto grid w-full cursor-pointer ${poolRowGrid(columns)} items-center justify-between bg-gradient-to-r from-[#0F1041B2]/30 to-[#2F53A0CC]/30 px-4 py-4 backdrop-blur hover:!bg-white/5  ${isLast ? "rounded-b-2xl" : ""} ${isFirst ? "rounded-t-2xl" : ""}`}
        >
          <ChainLogo chain={contractData?.blockchain} />
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <PoolSnapshotAssets contractData={contractData} />
            {isNewPool(createdAt) && <span className="w-fit rounded-[40px] border border-accent px-3 py-1 text-xs font-bold text-white">New</span>}
          </div>
          {columns.status && <StatusAndStartEnd contractData={contractData} />}
          {columns.protocol && <ProtocolVersionLogo protocolVersion={contractData?.protocolVersion} protocol={contractData?.protocol} />}
          <PoolTotal contractData={contractData} />
          <PoolSubscribed contractData={contractData} />
          <PoolVolume contractData={contractData} />
          <PoolFees contractData={contractData} />
          <PoolRewards contractData={contractData} />
        </div>
      </Link>
    </div>
  );
}
