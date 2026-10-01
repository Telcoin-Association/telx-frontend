"use client";

import React, { useMemo, useState } from "react";
import PoolSnapshot from "@/components/pool/PoolSnapshot";
import PoolSnapshotLabels from "@/components/pool/PoolSnapshotLabels";
import PoolListSkeleton from "@/components/pool/PoolListSkeleton";
import { useAppSelector } from "@/redux/hooks";
import { contractsSelector } from "@/redux/slices/contractsSlice";
import { miningContractFields } from "@/helpers/normalizeMiningContracts";
import { getPoolMapKey } from "@/lib/contracts";
import { chainDisplayName } from "@/lib/poolTitle";
import {
  filterPools,
  POOL_CHAIN_FILTERS,
  sortPoolsBy,
  sortPoolsForDisplay,
  type PoolChainFilter,
  type PoolSort,
  type PoolSortKey,
} from "@/lib/poolOrder";
import { useNow } from "@/hooks/useNow";

interface PoolsMainProps {
  pools: miningContractFields[];
}

const CHIP = "cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200";
const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";

const chipLabel = (chain: PoolChainFilter) => (chain === "all" ? "All" : chainDisplayName(chain));

/** A header click sorts highest first, a second lowest first, and a third returns to the default order. */
function nextSort(current: PoolSort | null, key: PoolSortKey): PoolSort | null {
  if (current?.key !== key) return { key, direction: "desc" };
  return current.direction === "desc" ? { key, direction: "asc" } : null;
}

/**
 * The Pools page's active pools: by default ordered by network (Polygon, Base, Ethereum) and by campaign within a
 * network, with chain chips, a live-rewards filter and sortable figure columns.
 */
export default function PoolsMain(props: PoolsMainProps) {
  const { pools } = props;

  const contracts = useAppSelector(contractsSelector);
  const now = useNow();
  const [chain, setChain] = useState<PoolChainFilter>("all");
  const [liveOnly, setLiveOnly] = useState(false);
  const [sort, setSort] = useState<PoolSort | null>(null);

  const activeContracts = useMemo(() => {
    if (contracts && Object.values(contracts).length > 0) {
      const activeContractsList = pools.filter(
        (contract) => contract?.attributes?.active
      );
      return activeContractsList
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
    }
    return [];
  }, [pools, contracts]);

  // Chip counts follow the live-rewards filter, so each chip says what selecting it would show.
  const counts = useMemo(() => {
    const live = filterPools(activeContracts, { chain: "all", liveOnly }, now);
    return Object.fromEntries(POOL_CHAIN_FILTERS.map(option => [option, filterPools(live, { chain: option, liveOnly: false }, now).length])) as Record<
      PoolChainFilter,
      number
    >;
  }, [activeContracts, liveOnly, now]);

  const shown = useMemo(() => {
    const filtered = filterPools(activeContracts, { chain, liveOnly }, now);
    return sort ? sortPoolsBy(filtered, sort, now) : sortPoolsForDisplay(filtered, now);
  }, [activeContracts, chain, liveOnly, sort, now]);

  const showAll = () => {
    setChain("all");
    setLiveOnly(false);
  };

  if (activeContracts.length === 0) {
    return (
      <div className="overflow-x-auto rounded-b-2xl shadow-2xl">
        <div className="min-w-5xl">
          <PoolListSkeleton byNetwork />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter pools by chain" className="flex flex-wrap gap-2">
          {POOL_CHAIN_FILTERS.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={chain === option}
              onClick={() => setChain(option)}
              className={`${CHIP} ${chain === option ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {chipLabel(option)} <span className="font-bold">({counts[option]})</span>
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={liveOnly} onClick={() => setLiveOnly(value => !value)} className={`${CHIP} ${liveOnly ? CHIP_ACTIVE : CHIP_IDLE}`}>
          Live rewards only
        </button>
      </div>

      <div className="overflow-x-auto rounded-b-2xl shadow-2xl">
        <div className="min-w-5xl rounded-2xl border border-white/10">
          <PoolSnapshotLabels sort={sort} onSort={key => setSort(current => nextSort(current, key))} />
          <div className="mx-auto w-full max-w-7xl min-w-5xl">
            {shown.length > 0 ? (
              shown.map((contractData: any, i: number) => (
                <PoolSnapshot
                  key={`${contractData.blockchain}:${contractData.poolContractAddress}`}
                  contractData={contractData}
                  isLast={i === shown.length - 1}
                />
              ))
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-b-2xl bg-black/20 px-4 py-10 text-center">
                <p className="text-sm text-primary">No pools match these filters.</p>
                <button type="button" onClick={showAll} className={`${CHIP} ${CHIP_IDLE}`}>
                  Show all pools
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
