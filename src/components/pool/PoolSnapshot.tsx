import React from "react";
import Link from "next/link";
import PoolSnapshotAssets from "./PoolSnapshotAssets";
import StatusAndStartEnd from "../common/StatusAndStartEnd";
import PoolTotal from "./PoolTotal";
import PoolRewards from "./PoolRewards";
import ChainLogo from "@/components/common/ChainLogo";
import PoolStaked from "./PoolStaked";
import PoolFees from "./PoolFees";
import PoolVolume from "./PoolVolume";
import ProtocolVersionLogo from "../common/ProtocolVersionLogo";
import { getPoolPath } from "@/lib/contracts";

export default function PoolSnapshot({ contractData, isLast, isFirst }: { contractData: any; isLast?: boolean; isFirst?: boolean }) {
  const { poolContractAddress, blockchain, protocol } = contractData;

  return (
    <div>
      <Link href={getPoolPath(poolContractAddress, blockchain, protocol)}>
        <div
          className={`mx-auto grid w-full cursor-pointer grid-cols-[0.3fr_1fr_0.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr] lg:grid-cols-[0.4fr_2.5fr_0.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr]  items-center justify-between bg-gradient-to-r from-[#0F1041B2]/30 to-[#2F53A0CC]/30 px-4 py-4 backdrop-blur hover:!bg-white/5  ${isLast ? "rounded-b-2xl" : ""} ${isFirst ? "rounded-t-2xl" : ""}`}
        >
          <ChainLogo chain={contractData?.blockchain} />
          <PoolSnapshotAssets contractData={contractData} />
          <StatusAndStartEnd contractData={contractData} />
          <ProtocolVersionLogo protocolVersion={contractData?.protocolVersion} protocol={contractData?.protocol} />
          <PoolTotal contractData={contractData} />
          <PoolStaked contractData={contractData} />
          <PoolVolume contractData={contractData} />
          <PoolFees contractData={contractData} />
          <PoolRewards contractData={contractData} />
        </div>
      </Link>
    </div>
  );
}
