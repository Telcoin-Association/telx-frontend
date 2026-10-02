"use client";

import React, { useMemo, useState } from "react";
import PoolSnapshot from "@/components/pool/PoolSnapshot";
import PoolSnapshotLabels from "@/components/pool/PoolSnapshotLabels";
import PoolListSkeleton from "@/components/pool/PoolListSkeleton";
import PoolFilterBar, { CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/pools/PoolFilterBar";
import { useAppSelector } from "@/redux/hooks";
import { contractsSelector } from "@/redux/slices/contractsSlice";
import { miningContractFields } from "@/helpers/normalizeMiningContracts";
import { getPoolMapKey } from "@/lib/contracts";
import {
  filterPools,
  POOL_CHAIN_FILTERS,
  sortPoolsBy,
  sortPoolsForDisplay,
  type PoolChainFilter,
  type PoolSort,
  type PoolSortKey,
} from "@/lib/poolOrder";
import { buildTokenOptions, filterPoolsByTokens } from "@/lib/poolTokenFilter";
import { usePoolListUrlState } from "@/hooks/usePoolListUrlState";
import { useNow } from "@/hooks/useNow";

interface PoolsMainProps {
  pools: miningContractFields[];
}

/** A header click sorts highest first, a second lowest first, and a third returns to the default order. */
function nextSort(current: PoolSort | null, key: PoolSortKey): PoolSort | null {
  if (current?.key !== key) return { key, direction: "desc" };
  return current.direction === "desc" ? { key, direction: "asc" } : null;
}

/**
 * The Pools page's active pools: by default ordered by network (Polygon, Base, Ethereum) and by campaign within a
 * network, with token search and checkboxes, chain chips, a live-rewards filter and sortable figure columns. The
 * search, tokens and chain are kept in the URL.
 */
export default function PoolsMain(props: PoolsMainProps) {
  const { pools } = props;

  const contracts = useAppSelector(contractsSelector);
  const now = useNow();
  const { state: filters, update, reset } = usePoolListUrlState();
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

  const tokenOptions = useMemo(() => buildTokenOptions(activeContracts), [activeContracts]);

  // Pools matching every filter except the chain, so each chip says what selecting it would show.
  const beforeChain = useMemo(
    () => filterPools(filterPoolsByTokens(activeContracts, filters), { chain: "all", liveOnly }, now),
    [activeContracts, filters, liveOnly, now],
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(POOL_CHAIN_FILTERS.map(option => [option, filterPools(beforeChain, { chain: option, liveOnly: false }, now).length])) as Record<
        PoolChainFilter,
        number
      >,
    [beforeChain, now],
  );

  const shown = useMemo(() => {
    const filtered = filterPools(beforeChain, { chain: filters.chain, liveOnly: false }, now);
    return sort ? sortPoolsBy(filtered, sort, now) : sortPoolsForDisplay(filtered, now);
  }, [beforeChain, filters.chain, sort, now]);

  const showAll = () => {
    reset();
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
      <PoolFilterBar
        listName="pools"
        query={filters.query}
        onQueryChange={query => update({ query })}
        tokenOptions={tokenOptions}
        selectedTokens={filters.tokens}
        onSelectedTokensChange={tokens => update({ tokens })}
        matchAll={filters.matchAll}
        onMatchAllChange={matchAll => update({ matchAll })}
        chain={filters.chain}
        onChainChange={chain => update({ chain })}
        chainCounts={counts}
      >
        <button type="button" aria-pressed={liveOnly} onClick={() => setLiveOnly(value => !value)} className={`${CHIP} ${liveOnly ? CHIP_ACTIVE : CHIP_IDLE}`}>
          Live rewards only
        </button>
      </PoolFilterBar>

      <div className="overflow-x-auto rounded-b-2xl shadow-2xl">
        <div className="min-w-5xl rounded-2xl border border-white/10">
          {/* The wrapper is exactly as tall as the sticky header, so the header stays in place here rather than
              offsetting itself against the scroll container and covering the first row. */}
          <div>
            <PoolSnapshotLabels sort={sort} onSort={key => setSort(current => nextSort(current, key))} />
          </div>
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
