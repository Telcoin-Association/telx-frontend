"use client";

import ArchiveCards from "@/components/archive/ArchiveCards";
import PoolFilterBar, { CHIP, CHIP_IDLE } from "@/components/pools/PoolFilterBar";
import { useAppSelector } from "@/redux/hooks";
import { deprecatedPoolsListSelector } from "@/redux/slices/contractsSlice";
import { filterPools, POOL_CHAIN_FILTERS, type PoolChainFilter } from "@/lib/poolOrder";
import { buildTokenOptions, filterPoolsByTokens } from "@/lib/poolTokenFilter";
import { usePoolListUrlState } from "@/hooks/usePoolListUrlState";
import { useNow } from "@/hooks/useNow";
import type { ProtocolsContractData } from "@/web3/getContracts/shared";
import React, { useMemo } from "react";

/** The archived pools, with the same token search, token checkboxes and chain chips as the active list. */
export default function ArchivePage() {
  const archivePoolsList = useAppSelector(deprecatedPoolsListSelector);
  const now = useNow();
  const { state: filters, update, reset } = usePoolListUrlState();

  const archiveList = useMemo(() => Object.values(archivePoolsList ?? {}) as ProtocolsContractData[], [archivePoolsList]);
  const tokenOptions = useMemo(() => buildTokenOptions(archiveList), [archiveList]);
  const byToken = useMemo(() => filterPoolsByTokens(archiveList, filters), [archiveList, filters]);

  const counts = useMemo(
    () =>
      Object.fromEntries(POOL_CHAIN_FILTERS.map(option => [option, filterPools(byToken, { chain: option, liveOnly: false }, now).length])) as Record<
        PoolChainFilter,
        number
      >,
    [byToken, now],
  );
  const shown = useMemo(() => filterPools(byToken, { chain: filters.chain, liveOnly: false }, now), [byToken, filters.chain, now]);

  if (archiveList.length === 0) return <ArchiveCards contractsData={archiveList} />;

  return (
    <div className="flex flex-col gap-4">
      <PoolFilterBar
        listName="archived pools"
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
      />
      {shown.length > 0 ? (
        <ArchiveCards contractsData={shown} />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-10 text-center">
          <p className="text-sm text-primary">No archived pools match these filters.</p>
          <button type="button" onClick={reset} className={`${CHIP} ${CHIP_IDLE}`}>
            Show all archived pools
          </button>
        </div>
      )}
    </div>
  );
}
