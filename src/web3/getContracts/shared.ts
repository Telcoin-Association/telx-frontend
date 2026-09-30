import { dfxGetSingleContractData, DfxContractData } from "./dfx/getSingleContractData";
import { quickswapGetSingleContractData, QuickswapContractData } from "./quickswap/getSingleContractData";
import { balancerGetSingleContractData, BalancerContractData } from "./balancer/getSingleContractData";
import { UniswapContractData, uniswapGetSingleContractData } from "./uniswapv4/getSingleContractData";
import { miningContract } from "../../helpers/normalizeMiningContracts";
import { getTokenPricesCached } from "@/helpers/getTokenPricesCached";
import { prefetchPoolData } from "@/helpers/prefetchPoolData";
import { DataFreshness } from "@/types/PoolMetrics";
import { hasUserHoldings } from "@/lib/userHoldings";

export type ProtocolsContractData = BalancerContractData | DfxContractData | QuickswapContractData | UniswapContractData;

/** Where a legacy pool's wallet reads are skipped: see `emptyLegacyPools`. */
const legacyPoolKey = (value: miningContract) => `${value.protocol}:${value.blockchain}:${String(value.pool ?? "").toLowerCase()}`;
const isInactiveLegacyPool = (value: miningContract) => value.protocol !== "uniswap" && !value.active;

const positive = (value: unknown) => Number(value) > 0;

/** Whether a legacy pool's read shows nothing of the wallet's: no LP tokens, no stake and no rewards to claim. */
export function walletHasNothingIn(contract: unknown): boolean {
  const user = (contract as { user?: { balanceLPT?: unknown; deprecated?: { balanceLPT?: unknown } } })?.user;
  return !hasUserHoldings(contract) && !positive(user?.balanceLPT) && !positive(user?.deprecated?.balanceLPT);
}

/**
 * Per wallet, the inactive legacy pools (Balancer, QuickSwap, DFX) where its last full load found nothing of its
 * own. An inactive pool takes no new stakes through the app, so a background refresh reads these without the
 * wallet, which costs no RPC reads, and their wallet fields stay empty as they were. A full load (a page load,
 * a wallet change, or the reload after a stake, claim or unstake) reads every pool for the wallet again and
 * rebuilds the set.
 */
const emptyLegacyPools = new Map<string, Set<string>>();

/** Forgets every wallet's empty legacy pools, so the next load reads them all. For tests. */
export function resetEmptyLegacyPools() {
  emptyLegacyPools.clear();
}

export async function getAllContractData(
  CONTRACTS_DATA: miningContract[],
  selectedWalletAddress: string | undefined,
  { background = false }: { background?: boolean } = {}
): Promise<{ contracts: ProtocolsContractData[]; meta: DataFreshness }> {
  const contracts: ReturnType<typeof quickswapGetSingleContractData | typeof balancerGetSingleContractData | typeof dfxGetSingleContractData | typeof uniswapGetSingleContractData>[] = [];
  const read: miningContract[] = [];
  const { uniswapById, meta } = await prefetchPoolData(CONTRACTS_DATA);

  const wallet = selectedWalletAddress?.toLowerCase();
  const skip = background && wallet ? emptyLegacyPools.get(wallet) : undefined;
  const walletFor = (value: miningContract) => (skip?.has(legacyPoolKey(value)) ? undefined : selectedWalletAddress);

  for (let i = 0; i < CONTRACTS_DATA.length; i++) {
    const value = CONTRACTS_DATA[i];
    const poolKey = value.pool?.trim().toLowerCase();

    switch (value.protocol) {
      case "quickswap":
        read.push(value);
        contracts.push(quickswapGetSingleContractData(value, walletFor(value)));
        break;

      case "balancer":
        read.push(value);
        contracts.push(balancerGetSingleContractData(value, walletFor(value), getTokenPricesCached));
        break;

      case "dfx":
        read.push(value);
        contracts.push(dfxGetSingleContractData(value, walletFor(value)));
        break;
      case "uniswap":
        read.push(value);
        contracts.push(
          uniswapGetSingleContractData(
            value,
            selectedWalletAddress,
            uniswapById?.[`${value.blockchain}:${poolKey}`] || uniswapById?.[poolKey]
          )
        );
        break;
    }
  }
  const results = await Promise.all(contracts);

  if (wallet && !background) {
    const empty = new Set<string>();
    results.forEach((contract, i) => {
      if (isInactiveLegacyPool(read[i]) && walletHasNothingIn(contract)) empty.add(legacyPoolKey(read[i]));
    });
    emptyLegacyPools.set(wallet, empty);
  }
  return { contracts: results, meta };
}
