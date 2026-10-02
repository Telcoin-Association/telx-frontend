"use client";

import React from "react";
import ChainLogo from "@/components/common/ChainLogo";
import ProtocolVersionLogo from "@/components/common/ProtocolVersionLogo";
import PoolSnapshotAssets from "./PoolSnapshotAssets";
import PoolSnapshotLabels from "./PoolSnapshotLabels";
import { useAppSelector } from "@/redux/hooks";
import { contractsErrorSelector, contractsListSelector, failedAttemptsSelector, LOAD_RETRY_DELAYS_MS } from "@/redux/slices/contractsSlice";
import type { miningContract } from "@/helpers/normalizeMiningContracts";
import { NETWORK_DISPLAY_ORDER } from "@/lib/contracts";
import { ALL_POOL_COLUMNS, poolListColumns, poolRowGrid, type PoolListColumns } from "@/lib/poolColumns";

const chainRank = (chain: string) => {
  const rank = NETWORK_DISPLAY_ORDER.indexOf(chain.toLowerCase());
  return rank === -1 ? NETWORK_DISPLAY_ORDER.length : rank;
};

/** A figure that has not loaded yet: a pulsing bar, or "Unavailable" once the load has failed for good. */
export function SkeletonValue({ unavailable, className = "w-16" }: { unavailable: boolean; className?: string }) {
  if (unavailable) return <p className="text-sm text-primary">Unavailable</p>;
  return <span aria-hidden="true" data-testid="skeleton" className={`block h-4 animate-pulse rounded bg-white/10 ${className}`} />;
}

// Same columns as PoolSnapshot, so the table does not shift when the data arrives.
function SkeletonRow({ pool, unavailable, isLast, columns }: { pool: miningContract | null; unavailable: boolean; isLast: boolean; columns: PoolListColumns }) {
  return (
    <div
      className={`mx-auto grid w-full ${poolRowGrid(columns)} items-center justify-between bg-gradient-to-r from-[#0F1041B2]/30 to-[#2F53A0CC]/30 px-4 py-4 ${isLast ? "rounded-b-2xl" : ""}`}
    >
      {pool ? <ChainLogo chain={pool.blockchain} /> : <SkeletonValue unavailable={false} className="w-6" />}
      {pool ? <PoolSnapshotAssets assets={pool.assets} /> : <SkeletonValue unavailable={false} className="w-40" />}
      {columns.status && <SkeletonValue unavailable={false} className="w-12" />}
      {columns.protocol && <div className="flex justify-center">{pool ? <ProtocolVersionLogo protocol={pool.protocol} protocolVersion={pool.protocolVersion} /> : null}</div>}
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex justify-end">
          <SkeletonValue unavailable={unavailable} />
        </div>
      ))}
    </div>
  );
}

/** A pool card while its figures load, matching PoolCard on narrow screens. */
function SkeletonCard({ pool, unavailable }: { pool: miningContract | null; unavailable: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-[#0F1041B2]/30 to-[#2F53A0CC]/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {pool ? <ChainLogo chain={pool.blockchain} /> : <SkeletonValue unavailable={false} className="w-6" />}
          {pool ? <PoolSnapshotAssets assets={pool.assets} flex /> : <SkeletonValue unavailable={false} className="w-32" />}
        </div>
        <SkeletonValue unavailable={unavailable} className="w-20" />
      </div>
      <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
        {["TVL", "SVL", "Volume (24hr)", "Fees (24hr)"].map(label => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-xs text-primary">{label}</span>
            <SkeletonValue unavailable={unavailable} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The pool table while pool data loads: the column headers and a row per active registry pool with its
 * chain, tokens and protocol, and a placeholder for every figure. Once the load has failed for good the
 * placeholders read "Unavailable" instead of pulsing. `byNetwork` orders the rows as the home page does,
 * so they keep their places when the data replaces them. `columns: "auto"` drops the Status and Protocol columns
 * when every pool would read the same, as the loaded list does. `cards` shows cards instead of the table below `sm`.
 */
export default function PoolListSkeleton({
  limit,
  byNetwork = false,
  columns: columnsProp = ALL_POOL_COLUMNS,
  cards = false,
}: {
  limit?: number;
  byNetwork?: boolean;
  columns?: PoolListColumns | "auto";
  cards?: boolean;
}) {
  const list = useAppSelector(contractsListSelector);
  const lastError = useAppSelector(contractsErrorSelector);
  const failedAttempts = useAppSelector(failedAttemptsSelector);
  const unavailable = lastError !== null && failedAttempts > LOAD_RETRY_DELAYS_MS.length;

  const active = list.filter((pool) => pool.active);
  if (byNetwork) active.sort((a, b) => chainRank(a.blockchain) - chainRank(b.blockchain));
  const pools: (miningContract | null)[] = active.length > 0 ? active.slice(0, limit ?? active.length) : [null, null, null];
  const columns = columnsProp === "auto" ? poolListColumns(active) : columnsProp;

  const table = (
    <div className="rounded-2xl border border-white/10" aria-busy={!unavailable} aria-label="Loading pools">
      {/* Wrapped so the sticky header stays above the rows, as on the loaded list. */}
      <div>
        <PoolSnapshotLabels columns={columns} />
      </div>
      <div className="mx-auto w-full max-w-7xl">
        {pools.map((pool, i) => (
          <SkeletonRow key={pool ? `${pool.blockchain}:${pool.pool}` : i} pool={pool} unavailable={unavailable} isLast={i === pools.length - 1} columns={columns} />
        ))}
      </div>
    </div>
  );
  if (!cards) return table;
  return (
    <>
      <div className="flex flex-col gap-3 sm:hidden" aria-busy={!unavailable} aria-label="Loading pools">
        {pools.map((pool, i) => (
          <SkeletonCard key={pool ? `${pool.blockchain}:${pool.pool}` : i} pool={pool} unavailable={unavailable} />
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-2xl shadow-2xl sm:block">
        <div className="min-w-5xl">{table}</div>
      </div>
    </>
  );
}
