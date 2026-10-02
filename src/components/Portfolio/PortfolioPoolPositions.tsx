import React, { useEffect, useMemo } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import ChainLogo from "../common/ChainLogo";
import PositionsList from "../common/PositionsList";
import { usePositionActions } from "@/hooks/usePositionActions";
import { usePoolRewards } from "@/hooks/usePositionRewards";
import { useCollectEstimates } from "@/hooks/useCollectEstimates";
import { getPoolPath, getUniswapChainAddresses, isMerklUniswapPool } from "@/lib/contracts";
import { collectTarget, hasCollectableFees } from "@/lib/v4/collect";
import { chainDisplayName } from "@/lib/poolTitle";
import { formatUsd, orderPoolAssets, type PoolAsset, type UsdRates } from "@/lib/positionView";
import { summarizePositions } from "@/lib/portfolioSummary";
import { positionsChainFor, type Position } from "@/lib/positions";

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
 * open positions, and the same position rows as the pool page: TELx rewards, uncollected fees, collecting and the
 * subscription actions.
 */
export default function PortfolioPoolPositions({
  pool,
  positions,
  rates,
  onConfirmed,
  onConfirmedStatuses,
}: {
  pool: PortfolioPool;
  positions: Position[];
  rates: UsdRates | undefined;
  /** Called with the confirming block after a transaction, so the page can reload this chain's positions. */
  onConfirmed: (blockNumber: number | undefined) => void;
  /**
   * Called with the subscription state each row holds after a confirmed action (token id to subscribed), so
   * the page's summary counts agree with the rows before the follow-up positions read returns.
   */
  onConfirmedStatuses?: (statuses: Record<string, boolean>) => void;
}) {
  const assets = useMemo(() => orderPoolAssets(pool.assets), [pool.assets]);
  const { address } = useAccount();
  const { pending, results, subscribe, unsubscribe, collect, subscribeNeedsInRange } = usePositionActions({
    blockchain: pool.blockchain,
    poolId: pool.poolContractAddress,
    onConfirmed,
  });
  const name = portfolioPoolName(pool);
  const chain = positionsChainFor(pool.blockchain);
  const merklPool = isMerklUniswapPool(pool.poolContractAddress);
  const rewards = usePoolRewards(chain, pool.poolContractAddress, merklPool);
  const collectTargets = useMemo(
    () => positions.filter(hasCollectableFees).map(position => collectTarget(position, pool.poolContractAddress)),
    [positions, pool.poolContractAddress],
  );
  const collectEstimates = useCollectEstimates({
    chain,
    positionManager: getUniswapChainAddresses(pool.blockchain, pool.poolContractAddress).positionManager as `0x${string}`,
    owner: address,
    targets: collectTargets,
    enabled: Boolean(address),
  });

  useEffect(() => {
    if (!onConfirmedStatuses) return;
    const statuses: Record<string, boolean> = {};
    for (const [tokenId, result] of Object.entries(results)) {
      if (typeof result.subscribed === "boolean") statuses[tokenId] = result.subscribed;
    }
    onConfirmedStatuses(statuses);
    // Reported whenever a row's outcome changes; the callback identity does not matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

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
        chain={chain}
        rewards={merklPool ? rewards : undefined}
        poolId={pool.poolContractAddress}
        onCollect={collect}
        collectEstimates={collectEstimates}
      />
    </div>
  );
}
