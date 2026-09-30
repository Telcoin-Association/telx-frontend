import React, { useMemo } from "react";
import Link from "next/link";
import ChainLogo from "../common/ChainLogo";
import PositionsList from "../common/PositionsList";
import { usePositionActions } from "@/hooks/usePositionActions";
import { getPoolPath } from "@/lib/contracts";
import { chainDisplayName } from "@/lib/poolTitle";
import { formatUsd, orderPoolAssets, type PoolAsset, type UsdRates } from "@/lib/positionView";
import { summarizePositions } from "@/lib/portfolioSummary";
import type { Position } from "@/lib/positions";

export type PortfolioPool = {
  poolContractAddress: string;
  blockchain: string;
  protocol?: string;
  assets?: PoolAsset[];
  addLiquidityLink?: string;
};

/** "WETH/TEL on Polygon", from the pool's tickers in registry order. */
export function portfolioPoolName(pool: Pick<PortfolioPool, "assets" | "blockchain">): string {
  const symbols = (pool.assets ?? []).map(asset => asset.ticker).filter(Boolean);
  const pair = symbols.length > 0 ? symbols.join("/") : "Uniswap v4 pool";
  return pool.blockchain ? `${pair} on ${chainDisplayName(pool.blockchain)}` : pair;
}

/**
 * The summed USD value of a pool's open positions for its heading, marked partial when some open position
 * has no price. Nothing is shown for a pool without open positions.
 */
export function PoolPositionsTotal({ pool, positions, rates }: { pool: PortfolioPool; positions: Position[]; rates: UsdRates | undefined }) {
  const { valueUsd, unpriced, open } = summarizePositions([{ assets: pool.assets, positions }], rates);
  if (open === 0) return null;
  if (valueUsd === null) return <span className="text-sm font-normal text-primary">Value unavailable</span>;
  const note = unpriced > 0 ? `Excludes ${unpriced} position${unpriced === 1 ? "" : "s"} without a price.` : null;
  return (
    <span className="flex items-center gap-2 text-sm font-normal text-white">
      {formatUsd(valueUsd)}
      {note && (
        <span className="text-xs text-amber-400" title={note}>
          partial<span className="sr-only">: {note}</span>
        </span>
      )}
    </span>
  );
}

/**
 * One pool's positions on the Portfolio page: a heading that links to the pool page and totals the pool's
 * open positions, and the same filtered list with per-row Subscribe and Unsubscribe actions as the pool page.
 */
export default function PortfolioPoolPositions({
  pool,
  positions,
  rates,
  onConfirmed,
}: {
  pool: PortfolioPool;
  positions: Position[];
  rates: UsdRates | undefined;
  /** Called with the confirming block after a transaction, so the page can reload this chain's positions. */
  onConfirmed: (blockNumber: number | undefined) => void;
}) {
  const assets = useMemo(() => orderPoolAssets(pool.assets), [pool.assets]);
  const { pending, results, subscribe, unsubscribe, subscribeNeedsInRange } = usePositionActions({
    blockchain: pool.blockchain,
    poolId: pool.poolContractAddress,
    onConfirmed,
  });
  const name = portfolioPoolName(pool);

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-black/20 p-4">
      <PositionsList
        title={
          <span className="flex flex-wrap items-center gap-2">
            <ChainLogo chain={pool.blockchain} size={20} />
            <Link href={getPoolPath(pool.poolContractAddress, pool.blockchain, pool.protocol ?? "uniswap")} className="hover:underline">
              {name}
            </Link>
            <PoolPositionsTotal pool={pool} positions={positions} rates={rates} />
          </span>
        }
        positions={positions}
        assets={assets}
        rates={rates}
        pending={pending}
        results={results}
        onSubscribe={subscribe}
        onUnsubscribe={unsubscribe}
        addLiquidityLink={pool.addLiquidityLink}
        subscribeNeedsInRange={subscribeNeedsInRange}
      />
    </div>
  );
}
