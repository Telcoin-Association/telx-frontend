"use client";

import React, { useMemo } from "react";
import PoolSnapshot from "@/components/pool/PoolSnapshot";
import PoolSnapshotLabels from "@/components/pool/PoolSnapshotLabels";
import PoolListSkeleton from "@/components/pool/PoolListSkeleton";
import { useAppSelector } from "@/redux/hooks";
import { contractsSelector } from "@/redux/slices/contractsSlice";
import { miningContractFields } from "@/helpers/normalizeMiningContracts";
import { getPoolMapKey } from "@/lib/contracts";
import { sortPoolsForDisplay } from "@/lib/poolOrder";
import { useNow } from "@/hooks/useNow";

interface PoolsMainProps {
  pools: miningContractFields[];
}

export default function PoolsMain(props: PoolsMainProps) {
  const { pools } = props;

  const contracts = useAppSelector(contractsSelector);
  const now = useNow();

  const activeContracts = useMemo(() => {
    if (contracts && Object.values(contracts).length > 0) {
      const activeContractsList = pools.filter(
        (contract) => contract?.attributes?.active
      );
      const loaded = activeContractsList
        .map(contract => {
          const poolAddress = contract?.attributes?.pool_address;
          if (poolAddress) {
            const key = getPoolMapKey(
              poolAddress,
              contract?.attributes?.blockchain,
              contract?.attributes?.protocol
            );
            return contracts[key] || contracts[poolAddress];
          }
        })
        .filter((contract): contract is NonNullable<typeof contract> => Boolean(contract));
      return sortPoolsForDisplay(loaded, now);
    }
    return [];
  }, [pools, contracts, now]);

  return (
    <>
      {activeContracts?.length > 0 ? (
        <div>
          <div className="overflow-x-auto rounded-b-2xl shadow-2xl">
            <div className="min-w-5xl rounded-2xl border border-white/10">
              <div className="">
                <PoolSnapshotLabels />
              </div>
              <div className="mx-auto w-full max-w-7xl min-w-5xl">
                {activeContracts.map((contractData: any, i: any) => (
                  <PoolSnapshot key={i} contractData={contractData} isLast={i === activeContracts.length - 1} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-b-2xl shadow-2xl">
          <div className="min-w-5xl">
            <PoolListSkeleton byNetwork />
          </div>
        </div>
      )}
    </>
  );
}
