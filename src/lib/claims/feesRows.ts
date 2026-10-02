import type { MerklBlockchain } from "@/merkl/merklConstants";
import type { Position } from "@/lib/positions";
import { formatTokenAmount, orderPoolAssets, positionUsdValue, type PoolAsset, type UsdRates } from "@/lib/positionView";
import { collectTarget, hasCollectableFees } from "@/lib/v4/collect";
import type { FeesRowInput } from "./claimPlan";

/** One pool's positions as Portfolio holds them. */
export type FeesPoolGroup = { chain: MerklBlockchain; poolId: string; assets: readonly PoolAsset[] | undefined; positions: readonly Position[] };

/**
 * Claim all's fees row for each chain: every position with fees waiting in `groups`, the fees in words summed per
 * token (for example "0.003 WETH · 13 TEL"), and their USD value, or null when any of them can't be priced.
 */
export function feesCollectableByChain(groups: readonly FeesPoolGroup[], rates: UsdRates | undefined): Partial<Record<MerklBlockchain, Pick<FeesRowInput, "targets" | "summary" | "valueUsd">>> {
  type Entry = { targets: FeesRowInput["targets"]; totals: Map<string, number>; valueUsd: number | null };
  const byChain: Partial<Record<MerklBlockchain, Entry>> = {};
  for (const group of groups) {
    const assets = orderPoolAssets(group.assets as PoolAsset[] | undefined);
    for (const position of group.positions) {
      if (!hasCollectableFees(position) || !position.fees) continue;
      const entry: Entry = (byChain[group.chain] ??= { targets: [], totals: new Map(), valueUsd: 0 });
      entry.targets.push(collectTarget(position, group.poolId));
      [position.fees.amount0, position.fees.amount1].forEach((amount, i) => {
        const ticker = assets[i]?.ticker ?? `token ${i}`;
        if (Number(amount) > 0) entry.totals.set(ticker, (entry.totals.get(ticker) ?? 0) + Number(amount));
      });
      const usd = positionUsdValue({ amounts: { ...position.fees, sqrtPriceX96: "0" }, price: position.price }, assets[0], assets[1], rates);
      entry.valueUsd = entry.valueUsd === null || usd === null ? null : entry.valueUsd + usd;
    }
  }
  return Object.fromEntries(
    Object.entries(byChain).map(([chain, entry]) => [
      chain,
      {
        targets: entry!.targets,
        summary: [...entry!.totals].map(([ticker, amount]) => `${formatTokenAmount(amount)} ${ticker}`).join(" · "),
        valueUsd: entry!.valueUsd,
      },
    ]),
  );
}
