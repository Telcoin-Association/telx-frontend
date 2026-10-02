import type { MerklBlockchain } from "@/merkl/merklConstants";
import { MERKL_CHAIN_CONFIG } from "@/merkl/merklConstants";
import type { CollectTarget } from "@/lib/v4/collect";
import type { OldPoolsChain } from "./claimCore";

/*
 * The Claim all plan: one row per claim transaction, which is one per chain and source.
 * - Merkl rows pay TEL; old pools rows pay legacy TEL, which has no USD rate and must be upgraded afterwards.
 * - Fees rows collect the Uniswap trading fees of the wallet's TELx positions on a chain, in one PositionManager call.
 * - Every row starts checked, except a priced row whose estimated network fee is more than it's worth.
 * - Rows on the wallet's current chain come first, so the first claim needs no network switch. The rest follow
 *   by USD value, largest first, then unpriced rows by amount.
 */

export type ClaimKind = "merkl" | "oldPools" | "fees";

/**
 * A chain's uncollected trading fees: the positions to collect from, the amounts in words (for example
 * "0.003 WETH · 8 TEL"), and their USD value when priced. It pays no TEL, so `amountTel` is 0.
 */
export type FeesRowInput = { kind: "fees"; chain: MerklBlockchain; amountTel: 0; targets: CollectTarget[]; summary: string; valueUsd: number | null };

export type ClaimRowInput =
  | { kind: "merkl"; chain: MerklBlockchain; amountTel: number }
  | { kind: "oldPools"; chain: OldPoolsChain; amountTel: number }
  | FeesRowInput;

export type ClaimRow = ClaimRowInput & {
  id: string;
  chainId: number;
  /** USD value, or null when the amount has no price (legacy TEL, or no TEL rate). */
  valueUsd: number | null;
  /** Estimated network fee in USD, or null when it couldn't be estimated. */
  feeUsd: number | null;
  /** True when the estimated fee is more than the claim is worth. */
  uneconomic: boolean;
  checked: boolean;
};

export const claimRowId = (row: Pick<ClaimRowInput, "kind" | "chain">) => `${row.kind}:${row.chain}`;

/** A claim row for each source with something claimable, before fees are known. */
export function claimRowInputs(
  merklClaimable: Partial<Record<MerklBlockchain, number | null | undefined>>,
  oldPoolsClaimable: Partial<Record<OldPoolsChain, number | null | undefined>>,
  feesCollectable: Partial<Record<MerklBlockchain, Pick<FeesRowInput, "targets" | "summary" | "valueUsd"> | null | undefined>> = {}
): ClaimRowInput[] {
  const rows: ClaimRowInput[] = [];
  for (const [chain, amount] of Object.entries(merklClaimable) as [MerklBlockchain, number | null | undefined][]) {
    if (amount && amount > 0) rows.push({ kind: "merkl", chain, amountTel: amount });
  }
  for (const [chain, amount] of Object.entries(oldPoolsClaimable) as [OldPoolsChain, number | null | undefined][]) {
    if (amount && amount > 0) rows.push({ kind: "oldPools", chain, amountTel: amount });
  }
  for (const [chain, fees] of Object.entries(feesCollectable) as [MerklBlockchain, FeesRowInput | null | undefined][]) {
    if (fees && fees.targets.length > 0) rows.push({ kind: "fees", chain, amountTel: 0, targets: fees.targets, summary: fees.summary, valueUsd: fees.valueUsd });
  }
  return rows;
}

export function buildClaimPlan(
  inputs: readonly ClaimRowInput[],
  options: { currentChainId?: number; telUsd: number | null; feesUsd?: Partial<Record<string, number | null>> }
): ClaimRow[] {
  const rows = inputs.map((input): ClaimRow => {
    const id = claimRowId(input);
    const valueUsd = input.kind === "fees" ? input.valueUsd : input.kind === "merkl" && options.telUsd ? input.amountTel * options.telUsd : null;
    const feeUsd = options.feesUsd?.[id] ?? null;
    const uneconomic = valueUsd !== null && feeUsd !== null && feeUsd > valueUsd;
    return { ...input, id, chainId: MERKL_CHAIN_CONFIG[input.chain].chainId, valueUsd, feeUsd, uneconomic, checked: !uneconomic };
  });
  const onCurrent = (row: ClaimRow) => (row.chainId === options.currentChainId ? 0 : 1);
  return rows.sort(
    (a, b) =>
      onCurrent(a) - onCurrent(b) ||
      (b.valueUsd ?? -1) - (a.valueUsd ?? -1) ||
      b.amountTel - a.amountTel ||
      a.id.localeCompare(b.id)
  );
}

/** The tile's button label: "Claim TEL" for one chain, "Claim all (N chains)" for several. */
export function claimAllLabel(inputs: readonly ClaimRowInput[]): string {
  const chains = new Set(inputs.map((input) => input.chain));
  return chains.size > 1 ? `Claim all (${chains.size} chains)` : "Claim TEL";
}
