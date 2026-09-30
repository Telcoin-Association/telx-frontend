import { ContractFunctionRevertedError, decodeErrorResult, isHex } from "viem";
import { vaultAbi } from "./abis";
import { AppError, VaultStateChangedError } from "./errors";
import type { StateChange } from "./types";

const BLACKLISTED = "This wallet cannot send or receive eUSD.";
const TRANSFER_FAILED = "The token transfer failed. Check your balance and approval, then try again.";

// The vault's errors and eUSD's, which OpenZeppelin 5.5's SafeERC20 re-raises unchanged through a swap.
const CHANGE_BY_ERROR: ReadonlyMap<string, StateChange> = new Map<string, StateChange>([
  ["EnforcedPause", "paused"],
  ["InsufficientReserves", "reserves"],
  ["ExceedsTransactionLimit", "per-transaction"],
  ["ExceedsBlockLimit", "per-block"],
  ["ZeroAmount", "zero-output"],
  ["ERC20InsufficientAllowance", "allowance"],
  ["ERC20InsufficientBalance", "balance"],
]);

// USDC (FiatToken) reverts with `Error(string)`. First match wins.
const USDC_REASONS: ReadonlyArray<readonly [needle: string, meaning: StateChange | "blacklisted"]> = [
  ["exceeds allowance", "allowance"],
  ["exceeds balance", "balance"],
  ["blacklisted", "blacklisted"],
  ["paused", "paused"],
];

// Wallets nest the RPC error a few levels deep; nothing legitimate needs more than this.
const MAX_NODES = 16;

type Revert = Readonly<{ errorName: string; reason?: string }>;

function decodeRevertData(data: unknown): Revert | undefined {
  // A selector is 4 bytes.
  if (typeof data !== "string" || !isHex(data) || data.length < 10) return undefined;
  try {
    const decoded = decodeErrorResult({ abi: vaultAbi, data });
    // viem also decodes the built-in `Error(string)` and `Panic(uint256)`, which its types leave out.
    const errorName: string = decoded.errorName;
    const first: unknown = decoded.args?.[0];
    return { errorName, reason: errorName === "Error" && typeof first === "string" ? first : undefined };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function revertOf(node: Record<string, unknown>): Revert | undefined {
  // Checked by name as well, for wallet SDKs that bundle their own copy of viem.
  if (node instanceof ContractFunctionRevertedError || node.name === "ContractFunctionRevertedError") {
    const decoded = node.data;
    if (isRecord(decoded) && typeof decoded.errorName === "string") {
      const reason = decoded.errorName === "Error" && typeof node.reason === "string" ? node.reason : undefined;
      return { errorName: decoded.errorName, reason };
    }
    return decodeRevertData(node.raw);
  }
  return decodeRevertData(node.data);
}

/** Breadth first over `cause` and `data`, so revert data an RPC error carries under `data.data` is found too. */
function findRevert(error: unknown): Revert | undefined {
  const seen = new Set<object>();
  const queue: unknown[] = [error];
  while (queue.length > 0 && seen.size < MAX_NODES) {
    const node = queue.shift();
    if (!isRecord(node) || seen.has(node)) continue;
    seen.add(node);
    const revert = revertOf(node);
    if (revert) return revert;
    queue.push(node.cause, node.data);
  }
  return undefined;
}

function stateChanged(change: StateChange, cause: unknown): VaultStateChangedError {
  // A simulated revert is the chain's answer at the latest block; retrying the same request would repeat it.
  return new VaultStateChangedError(change, { retryable: false, cause });
}

function toVaultError(revert: Revert, cause: unknown): VaultStateChangedError | AppError | undefined {
  if (revert.errorName === "Blacklisted") return new AppError(BLACKLISTED, { cause });
  // Only a token call that returned false or a token without code; a short allowance is the token's own revert.
  if (revert.errorName === "SafeERC20FailedOperation") return new AppError(TRANSFER_FAILED, { cause });
  if (revert.errorName === "Error") {
    const reason = revert.reason?.toLowerCase();
    const match = reason === undefined ? undefined : USDC_REASONS.find(([needle]) => reason.includes(needle));
    if (match === undefined) return undefined;
    return match[1] === "blacklisted" ? new AppError(BLACKLISTED, { cause }) : stateChanged(match[1], cause);
  }
  const change = CHANGE_BY_ERROR.get(revert.errorName);
  return change === undefined ? undefined : stateChanged(change, cause);
}

/**
 * Turns the revert of a simulated or estimated swap into the state change it signals. Returns `undefined` for
 * anything it does not recognise (another revert, a network failure, a rejection), so the caller falls back to
 * `describeError`. The returned error keeps `error` as its cause and never carries the error's text.
 */
export function decodeVaultRevert(error: unknown): VaultStateChangedError | AppError | undefined {
  try {
    const revert = findRevert(error);
    return revert === undefined ? undefined : toVaultError(revert, error);
  } catch {
    // A hostile or broken error object (a throwing getter) must not replace the error being handled.
    return undefined;
  }
}
