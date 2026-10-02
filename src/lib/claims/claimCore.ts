import type { Address, Chain, Hash, PublicClient, TransactionReceipt, WalletClient } from "viem";
import { base, mainnet, polygon } from "viem/chains";
import { MERKL_DISTRIBUTOR_ABI, MERKL_DISTRIBUTOR_ADDRESS, type MerklBlockchain } from "@/merkl/merklConstants";
import type { ParsedMerklReward } from "@/merkl/merklTypes";
import { BASE_POSITION_REGISTRY, POLYGON_POSITION_REGISTRY } from "@/lib/contracts";
import { positionRegistryAbi } from "@/app/api/backendHelpers/helpers";

/*
 * The claim transactions TELx sends, shared by each chain's claim card and by Claim all:
 * - Merkl: one Distributor `claim` per chain, carrying every claimable token with its cumulative amount and proof;
 * - old pools: the position registry's `claim()`, on Base and Polygon only.
 * `sendClaim` simulates first, so a claim that would revert never reaches the wallet, then waits for the receipt.
 */

export type OldPoolsChain = "base" | "polygon";

export const CLAIM_CHAINS: Record<MerklBlockchain, Chain> = {
  ethereum: mainnet,
  base,
  polygon,
};

export const OLD_POOLS_REGISTRY: Record<OldPoolsChain, Address> = {
  base: BASE_POSITION_REGISTRY as Address,
  polygon: POLYGON_POSITION_REGISTRY as Address,
};

/** Legacy TEL, which the old pools pay, has 2 decimals. */
export const LEGACY_TEL_DECIMALS = 2;

export type ClaimRequest = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

/** The Distributor claim for every claimable reward on one chain, with cumulative amounts as the contract expects. */
export function merklClaimRequest(user: Address, claimable: readonly ParsedMerklReward[]): ClaimRequest {
  return {
    address: MERKL_DISTRIBUTOR_ADDRESS,
    abi: MERKL_DISTRIBUTOR_ABI,
    functionName: "claim",
    args: [
      claimable.map(() => user),
      claimable.map((reward) => reward.tokenAddress as Address),
      claimable.map((reward) => BigInt(reward.amount)),
      claimable.map((reward) => reward.proofs as Hash[]),
    ],
  };
}

/** The old pools registry claim on `chain`, which pays the caller everything owed to them. */
export function oldPoolsClaimRequest(chain: OldPoolsChain): ClaimRequest {
  return { address: OLD_POOLS_REGISTRY[chain], abi: positionRegistryAbi, functionName: "claim" };
}

/** Thrown when a claim's simulation fails, before any wallet prompt. */
export class ClaimSimulationError extends Error {
  constructor(public readonly reason: string, options?: { cause?: unknown }) {
    super(`The claim would fail: ${reason}`, options);
    this.name = "ClaimSimulationError";
  }
}

/** Thrown when a mined claim reverted, so nothing was claimed. */
export class ClaimRevertedError extends Error {
  constructor(public readonly hash: Hash) {
    super("The claim reverted on chain, so nothing was claimed.");
    this.name = "ClaimRevertedError";
  }
}

/** The shortest readable message viem gives for an error. */
export function errorReason(error: unknown): string {
  const record = error as { shortMessage?: unknown; message?: unknown } | null;
  if (record && typeof record.shortMessage === "string" && record.shortMessage) return record.shortMessage;
  if (record && typeof record.message === "string" && record.message) return record.message.split("\n")[0];
  return "unknown error";
}

export type SendClaimArgs = {
  publicClient: Pick<PublicClient, "simulateContract" | "waitForTransactionReceipt">;
  walletClient: Pick<WalletClient, "writeContract">;
  chain: Chain;
  account: Address;
  request: ClaimRequest;
  /** Called once the wallet has signed and sent, with the transaction hash. */
  onSent?: (hash: Hash) => void;
};

/**
 * Simulates `request` from `account`, sends it through the wallet, and waits for the receipt. Throws
 * ClaimSimulationError when the simulation fails, ClaimRevertedError when the mined claim reverted, and passes
 * wallet errors (such as a rejected signature) through unchanged.
 */
export async function sendClaim({ publicClient, walletClient, chain, account, request, onSent }: SendClaimArgs): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
  try {
    await publicClient.simulateContract({ ...request, account, chain } as Parameters<PublicClient["simulateContract"]>[0]);
  } catch (error) {
    throw new ClaimSimulationError(errorReason(error), { cause: error });
  }
  const hash = await walletClient.writeContract({ ...request, account, chain } as Parameters<WalletClient["writeContract"]>[0]);
  onSent?.(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new ClaimRevertedError(hash);
  return { hash, receipt };
}

/** The network fee for `request` from `account` in the chain's native token units, or null when it can't be estimated. */
export async function estimateClaimFeeWei(
  publicClient: Pick<PublicClient, "estimateContractGas" | "getGasPrice">,
  account: Address,
  request: ClaimRequest
): Promise<bigint | null> {
  try {
    const [gas, gasPrice] = await Promise.all([
      publicClient.estimateContractGas({ ...request, account } as Parameters<PublicClient["estimateContractGas"]>[0]),
      publicClient.getGasPrice(),
    ]);
    return gas * gasPrice;
  } catch {
    return null;
  }
}
