import { formatUnits, type Address, type Hash, type PublicClient, type WalletClient } from "viem";
import { MERKL_CHAIN_CONFIG, TEL_DECIMALS } from "@/merkl/merklConstants";
import type { FetchMerklRewardsResult } from "@/merkl/merklTypes";
import { chainDisplayName } from "@/lib/poolTitle";
import {
  CLAIM_CHAINS,
  ClaimRevertedError,
  ClaimSimulationError,
  errorReason,
  LEGACY_TEL_DECIMALS,
  merklClaimRequest,
  oldPoolsClaimRequest,
  sendClaim,
  type ClaimRequest,
} from "./claimCore";
import type { ClaimRow } from "./claimPlan";

/*
 * Runs one row of a Claim all plan: switch the wallet to the row's chain, read what is claimable there now
 * (fresh proofs for Merkl, the registry's figure for the old pools), simulate, send, and wait for the receipt.
 * Every step is reported through `onStatus`, so the panel can say where the claim is.
 */

export type ClaimRowStatus =
  | { state: "waiting" }
  | { state: "switching" }
  | { state: "manualSwitch" }
  | { state: "preparing" }
  /** `amountTel` is what the claim sends, read fresh just before the wallet prompt. */
  | { state: "confirm"; amountTel: number }
  | { state: "confirming"; hash: Hash }
  | { state: "claimed"; hash: Hash; amountTel: number }
  | { state: "skipped"; reason: string }
  | { state: "failed"; reason: string; hash?: Hash };

export type ClaimRowOutcome =
  | { kind: "claimed"; hash: Hash; amountTel: number }
  | { kind: "nothing" }
  | { kind: "failed"; reason: string; hash?: Hash };

export type ClaimClients = {
  publicClient: Pick<PublicClient, "simulateContract" | "waitForTransactionReceipt" | "estimateContractGas" | "getGasPrice">;
  walletClient: Pick<WalletClient, "writeContract">;
};

export type ClaimRowDeps = {
  account: Address;
  /** The chain the wallet is on now. */
  currentChainId: () => number | undefined;
  /** Asks the wallet to switch. Rejects when the visitor declines or the wallet can't switch on request. */
  switchChain: (chainId: number) => Promise<unknown>;
  /** Resolves once the wallet is on `chainId`, for wallets the visitor switches by hand. */
  waitForChain: (chainId: number, signal: AbortSignal) => Promise<void>;
  isUserRejection: (error: unknown) => boolean;
  /** Merkl rewards on `chainId`, read fresh rather than from a cache. */
  fetchMerkl: (chainId: number) => Promise<FetchMerklRewardsResult>;
  /** The old pools registry's unclaimed amount for the account on `chain`, in legacy TEL base units. */
  readOldPools: (chain: "base" | "polygon") => Promise<bigint>;
  getClients: (row: ClaimRow) => Promise<ClaimClients>;
};

/** What `row` would claim now: the request and its amount, or null when nothing is claimable there any more. */
export async function freshClaim(row: ClaimRow, deps: Pick<ClaimRowDeps, "account" | "fetchMerkl" | "readOldPools">): Promise<{ request: ClaimRequest; amountTel: number } | null> {
  if (row.kind === "merkl") {
    const rewards = await deps.fetchMerkl(MERKL_CHAIN_CONFIG[row.chain].chainId);
    const claimable = rewards.summary.claimableRewards;
    if (claimable.length === 0) return null;
    const decimals = claimable[0]?.tokenDecimals ?? TEL_DECIMALS;
    return { request: merklClaimRequest(deps.account, claimable), amountTel: Number(formatUnits(BigInt(rewards.summary.totalClaimable), decimals)) };
  }
  const unclaimed = await deps.readOldPools(row.chain);
  if (unclaimed <= 0n) return null;
  return { request: oldPoolsClaimRequest(row.chain), amountTel: Number(formatUnits(unclaimed, LEGACY_TEL_DECIMALS)) };
}

/** What the visitor chose after a row failed. */
export type ClaimDecision = "retry" | "skip" | "stop";

export type ClaimPlanResult = {
  claimed: { row: ClaimRow; amountTel: number; hash: Hash }[];
  /** True when the run ended early because the visitor stopped it. */
  stopped: boolean;
};

/**
 * Runs `rows` in order, one transaction at a time. A failed row pauses the run until `awaitDecision` says to
 * retry it, skip it, or stop; rows already claimed stay claimed either way. Aborting `signal` stops the run after
 * the current transaction, and the rows not reached are marked as skipped.
 */
export async function runClaimPlan(args: {
  rows: readonly ClaimRow[];
  deps: ClaimRowDeps;
  onStatus: (rowId: string, status: ClaimRowStatus) => void;
  awaitDecision: (rowId: string) => Promise<ClaimDecision>;
  onClaimed?: (row: ClaimRow, amountTel: number, hash: Hash) => void;
  signal: AbortSignal;
}): Promise<ClaimPlanResult> {
  const { rows, deps, onStatus, awaitDecision, onClaimed, signal } = args;
  const result: ClaimPlanResult = { claimed: [], stopped: false };
  rows.forEach((row) => onStatus(row.id, { state: "waiting" }));

  for (const row of rows) {
    if (signal.aborted || result.stopped) {
      result.stopped = true;
      onStatus(row.id, { state: "skipped", reason: "Stopped before this claim." });
      continue;
    }
    for (;;) {
      const outcome = await runClaimRow(row, deps, (status) => onStatus(row.id, status), signal);
      if (outcome.kind === "claimed") {
        onStatus(row.id, { state: "claimed", hash: outcome.hash, amountTel: outcome.amountTel });
        result.claimed.push({ row, amountTel: outcome.amountTel, hash: outcome.hash });
        onClaimed?.(row, outcome.amountTel, outcome.hash);
        break;
      }
      if (outcome.kind === "nothing") {
        onStatus(row.id, { state: "skipped", reason: `Nothing left to claim here.` });
        break;
      }
      onStatus(row.id, { state: "failed", reason: outcome.reason, hash: outcome.hash });
      const decision = signal.aborted ? "stop" : await awaitDecision(row.id);
      if (decision === "retry") continue;
      if (decision === "stop") result.stopped = true;
      else onStatus(row.id, { state: "skipped", reason: outcome.reason });
      break;
    }
  }
  return result;
}

export async function runClaimRow(row: ClaimRow, deps: ClaimRowDeps, onStatus: (status: ClaimRowStatus) => void, signal: AbortSignal): Promise<ClaimRowOutcome> {
  const chainName = chainDisplayName(row.chain);
  let hash: Hash | undefined;
  try {
    if (deps.currentChainId() !== row.chainId) {
      onStatus({ state: "switching" });
      try {
        await deps.switchChain(row.chainId);
      } catch (error) {
        if (deps.isUserRejection(error)) return { kind: "failed", reason: `The switch to ${chainName} was declined in the wallet.` };
        // Some wallets can't switch on request: the visitor switches by hand and the claim goes on from there.
        onStatus({ state: "manualSwitch" });
        await deps.waitForChain(row.chainId, signal);
      }
    }
    if (signal.aborted) return { kind: "failed", reason: "Stopped before this claim was sent." };

    onStatus({ state: "preparing" });
    const claim = await freshClaim(row, deps);
    if (!claim) return { kind: "nothing" };

    const { publicClient, walletClient } = await deps.getClients(row);
    onStatus({ state: "confirm", amountTel: claim.amountTel });
    const sent = await sendClaim({
      publicClient,
      walletClient,
      chain: CLAIM_CHAINS[row.chain],
      account: deps.account,
      request: claim.request,
      onSent: (sentHash) => {
        hash = sentHash;
        onStatus({ state: "confirming", hash: sentHash });
      },
    });
    return { kind: "claimed", hash: sent.hash, amountTel: claim.amountTel };
  } catch (error) {
    if (signal.aborted && !hash) return { kind: "failed", reason: "Stopped before this claim was sent." };
    if (deps.isUserRejection(error)) return { kind: "failed", reason: "The claim was rejected in the wallet." };
    if (error instanceof ClaimSimulationError) return { kind: "failed", reason: error.message };
    if (error instanceof ClaimRevertedError) return { kind: "failed", reason: error.message, hash: error.hash };
    return { kind: "failed", reason: `The claim on ${chainName} failed: ${errorReason(error)}`, hash };
  }
}
