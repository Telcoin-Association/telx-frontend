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

// Same columns as PoolSnapshot, so the table does not shift when the data arrives.
const ROW_GRID = "grid-cols-[0.3fr_1fr_0.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr] lg:grid-cols-[0.4fr_2.5fr_0.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr]";

const chainRank = (chain: string) => {
  const rank = NETWORK_DISPLAY_ORDER.indexOf(chain.toLowerCase());
  return rank === -1 ? NETWORK_DISPLAY_ORDER.length : rank;
};

/** A figure that has not loaded yet: a pulsing bar, or "Unavailable" once the load has failed for good. */
export function SkeletonValue({ unavailable, className = "w-16" }: { unavailable: boolean; className?: string }) {
  if (unavailable) return <p className="text-sm text-primary">Unavailable</p>;
  return <span aria-hidden="true" data-testid="skeleton" className={`block h-4 animate-pulse rounded bg-white/10 ${className}`} />;
}

function SkeletonRow({ pool, unavailable, isLast }: { pool: miningContract | null; unavailable: boolean; isLast: boolean }) {
  return (
    <div
      className={`mx-auto grid w-full ${ROW_GRID} items-center justify-between bg-gradient-to-r from-[#0F1041B2]/30 to-[#2F53A0CC]/30 px-4 py-4 ${isLast ? "rounded-b-2xl" : ""}`}
    >
      {pool ? <ChainLogo chain={pool.blockchain} /> : <SkeletonValue unavailable={false} className="w-6" />}
      {pool ? <PoolSnapshotAssets assets={pool.assets} /> : <SkeletonValue unavailable={false} className="w-40" />}
      <SkeletonValue unavailable={false} className="w-12" />
      <div className="flex justify-center">{pool ? <ProtocolVersionLogo protocol={pool.protocol} protocolVersion={pool.protocolVersion} /> : null}</div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex justify-end">
          <SkeletonValue unavailable={unavailable} />
        </div>
      ))}
    </div>
  );
}

/**
 * The pool table while pool data loads: the column headers and a row per active registry pool with its
 * chain, tokens and protocol, and a placeholder for every figure. Once the load has failed for good the
 * placeholders read "Unavailable" instead of pulsing. `byNetwork` orders the rows as the home page does,
 * so they keep their places when the data replaces them.
 */
export default function PoolListSkeleton({ limit, byNetwork = false }: { limit?: number; byNetwork?: boolean }) {
  const list = useAppSelector(contractsListSelector);
  const lastError = useAppSelector(contractsErrorSelector);
  const failedAttempts = useAppSelector(failedAttemptsSelector);
  const unavailable = lastError !== null && failedAttempts > LOAD_RETRY_DELAYS_MS.length;

  const active = list.filter((pool) => pool.active);
  if (byNetwork) active.sort((a, b) => chainRank(a.blockchain) - chainRank(b.blockchain));
  const pools: (miningContract | null)[] = active.length > 0 ? active.slice(0, limit ?? active.length) : [null, null, null];

  return (
    <div className="rounded-2xl border border-white/10" aria-busy={!unavailable} aria-label="Loading pools">
      {/* Wrapped so the sticky header stays above the rows, as on the loaded list. */}
      <div>
        <PoolSnapshotLabels />
      </div>
      <div className="mx-auto w-full max-w-7xl">
        {pools.map((pool, i) => (
          <SkeletonRow key={pool ? `${pool.blockchain}:${pool.pool}` : i} pool={pool} unavailable={unavailable} isLast={i === pools.length - 1} />
        ))}
      </div>
    </div>
  );
}
