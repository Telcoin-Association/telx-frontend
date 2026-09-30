import { UserRejectedRequestError } from "viem";

/** Wallet SDK cause chains are short. The bound also ends a cyclic chain. */
const MAX_CAUSE_DEPTH = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Wallet SDKs bundle their own copies of viem, so `instanceof` misses a rejection thrown by a nested copy. The
// class name and the EIP-1193 code (4001, or ethers' "ACTION_REJECTED") survive across copies.
function isRejection(value: Record<string, unknown>): boolean {
  return (
    value instanceof UserRejectedRequestError ||
    value.name === "UserRejectedRequestError" ||
    value.code === 4001 ||
    value.code === "ACTION_REJECTED"
  );
}

/**
 * Whether the user declined a wallet prompt, anywhere down the error's cause chain. viem wraps a rejection in
 * ContractFunctionExecutionError, and wallets nest the 4001 under a plain `cause`, so the top-level error type
 * is not enough.
 */
export function isUserRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && isRecord(current); depth += 1) {
    if (isRejection(current)) return true;
    current = current.cause;
  }
  return false;
}
