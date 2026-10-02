"use client";

import { useEffect, useState } from "react";
import { formatUnits, type Address, type PublicClient } from "viem";
import { publicClientBase, publicClientEthereum, publicClientPolygon } from "@/lib/publicClients";
import type { RpcChain } from "@/lib/rpc";
import { readCollect, type CollectPlan, type CollectTarget } from "@/lib/v4/collect";
import { fetchSwapPrices } from "@/web3/swap/usd";
import { NATIVE_TOKEN } from "@/web3/swap/tokens";

const PUBLIC_CLIENTS: Record<RpcChain, PublicClient> = {
  ethereum: publicClientEthereum as unknown as PublicClient,
  base: publicClientBase as unknown as PublicClient,
  polygon: publicClientPolygon as unknown as PublicClient,
};
const CHAIN_IDS: Record<RpcChain, number> = { ethereum: 1, base: 8453, polygon: 137 };

/** Estimated network fees for collecting, in USD: per position, and for every position at once. Null where unknown. */
export type CollectEstimates = { perToken: Record<string, number | null>; all: number | null };

/** The network fee of sending `plan` from `owner`, in the chain's native token, or null when it can't be estimated. */
export async function estimateCollectWei(client: Pick<PublicClient, "estimateContractGas" | "getGasPrice">, owner: Address, plan: CollectPlan): Promise<bigint | null> {
  try {
    const [gas, gasPrice] = await Promise.all([client.estimateContractGas({ ...plan.request, account: owner }), client.getGasPrice()]);
    return gas * gasPrice;
  } catch {
    return null;
  }
}

/**
 * Estimated network fees for collecting each position's fees, and all of them in one transaction, read once per set
 * of positions. Each estimate simulates the collect from `owner` on the pool's chain, whatever network the wallet is
 * on, and is priced with the chain's native token price. Positions with nothing to collect get no estimate.
 */
export function useCollectEstimates(args: { chain: RpcChain | undefined; positionManager: Address | undefined; owner: Address | undefined; targets: readonly CollectTarget[]; enabled: boolean }): CollectEstimates {
  const { chain, positionManager, owner, targets, enabled } = args;
  const [estimates, setEstimates] = useState<CollectEstimates>({ perToken: {}, all: null });
  // Targets are compared by value, so an equal list from a background refresh doesn't estimate again.
  const key = JSON.stringify(targets);

  useEffect(() => {
    setEstimates({ perToken: {}, all: null });
    if (!enabled || !chain || !positionManager || !owner || targets.length === 0) return;
    let cancelled = false;
    const client = PUBLIC_CLIENTS[chain];
    const chainId = CHAIN_IDS[chain];
    const toUsd = (wei: bigint | null, nativeUsd: number | undefined) => (wei === null || nativeUsd === undefined ? null : Number(formatUnits(wei, 18)) * nativeUsd);

    (async () => {
      const prices = await fetchSwapPrices(chain, [NATIVE_TOKEN]).catch(() => ({}) as Record<string, number>);
      const nativeUsd = prices[NATIVE_TOKEN.toLowerCase()];
      const estimate = async (subset: readonly CollectTarget[]) => {
        const plan = await readCollect(client, { chainId, positionManager, owner, targets: subset }).catch(() => null);
        return plan ? toUsd(await estimateCollectWei(client, owner, plan), nativeUsd) : null;
      };
      const [all, ...each] = await Promise.all([targets.length > 1 ? estimate(targets) : Promise.resolve(null), ...targets.map(target => estimate([target]))]);
      if (cancelled) return;
      setEstimates({ perToken: Object.fromEntries(targets.map((target, i) => [target.tokenId, each[i]])), all: targets.length > 1 ? all : (each[0] ?? null) });
    })();
    return () => {
      cancelled = true;
    };
    // `key` stands for `targets`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, positionManager, owner, key, enabled]);

  return estimates;
}
