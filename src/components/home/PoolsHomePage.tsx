import React from "react";
import LoadingWrapper from "../common/LoadingWrapper";
import PoolSnapshot from "../pool/PoolSnapshot";
import PoolSnapshotLabels from "../pool/PoolSnapshotLabels";
import Link from "next/link";
import PlusIcon from "../../../public/icons/plus-icon.svg";

export interface PoolsMainProps {
  activeContracts: any;
  defaultRewards: any;
}

export default function PoolsHomePage(props: PoolsMainProps) {
  const { activeContracts, defaultRewards } = props;
  const visibleContracts = activeContracts?.slice(0, 4);

  return (
    <div className="relative w-full">
      {activeContracts?.length > 0 ? (
        <div className="mb-20 flex flex-col gap-6">
          <h3 className="text-lg font-black text-white">Active Pools</h3>
          <div className="overflow-x-auto rounded-2xl shadow-2xl">
            <div className="rounded-2xl border border-white/10 shadow-2xl">
              <div className="min-w-5xl">
                <PoolSnapshotLabels />
              </div>
              <div className="mx-auto grid w-full max-w-7xl min-w-5xl xl:gap-0 xl:p-0 xl:px-0">
                {visibleContracts.map((contractData: any, i: any) => (
                  <PoolSnapshot key={i} contractData={contractData} isLast={i === visibleContracts.length - 1} />
                ))}
              </div>
            </div>
          </div>

          {/* Show "View All" button if more than 4 contracts */}
          {activeContracts.length > 4 && (
            <Link
              href="/pools"
              className="flex w-fit items-center gap-1.5 rounded-lg bg-ocean-gradient px-6 py-2 text-sm font-bold text-white transition hover:scale-105 duration-200"
            >
              View All Pools <PlusIcon height={20} width={20} />
            </Link>
          )}
        </div>
      ) : (
        <LoadingWrapper />
      )}
    </div>
  );
}
