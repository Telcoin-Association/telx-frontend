import { getAddress, isAddress, isAddressEqual, isHash, type Address, type Hash, type Hex } from "viem";
import { z } from "zod";
import { VAULT_CHAIN_IDS, getVaultDeployment, routeFor } from "./deployments";
import type {
  PendingContext,
  PendingStorage,
  SwapDirection,
  VaultLiveState,
  VaultPendingRecord,
} from "./types";

/**
 * How long a submitted transaction is tracked before the page stops waiting for it. An EOA transaction that has
 * not mined in 30 minutes was dropped or replaced; a smart account's can wait days for co-signers.
 */
export const PENDING_TTL_MS: Readonly<{ eoa: number; smartAccount: number }> = Object.freeze({
  eoa: 30 * 60_000,
  smartAccount: 7 * 24 * 60 * 60_000,
});

export function pendingTtlMs(smartAccount: boolean): number {
  return smartAccount ? PENDING_TTL_MS.smartAccount : PENDING_TTL_MS.eoa;
}

const KEY_PREFIX = "eusd-vault.pending.v1:";

export function pendingStorageKey(c: PendingContext): string {
  return `${KEY_PREFIX}${c.chainId}:${c.address.toLowerCase()}:${c.connectorId}`;
}

export function serializePendingRecord(r: VaultPendingRecord): string {
  return JSON.stringify({
    version: r.version,
    hash: r.hash,
    kind: r.kind,
    direction: r.direction,
    amountIn: r.amountIn.toString(),
    ...(r.kind === "swap" ? { quotedOut: r.quotedOut.toString(), quotedFee: r.quotedFee.toString() } : {}),
    chainId: r.chainId,
    address: r.address,
    connectorId: r.connectorId,
    smartAccount: r.smartAccount,
    submittedAt: r.submittedAt,
    expiresAt: r.expiresAt,
    vault: r.vault,
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
  });
}

const DIRECTIONS = ["usdcToEusd", "eusdToUsdc"] as const satisfies readonly SwapDirection[];

const decimalBigint = z
  .string()
  .regex(/^\d+$/)
  .transform((v) => BigInt(v));

const addressField = z
  .custom<string>((v) => typeof v === "string" && isAddress(v))
  .transform((v): Address => getAddress(v));

const baseFields = {
  version: z.literal(1),
  hash: z.custom<Hash>((v) => typeof v === "string" && isHash(v)),
  direction: z.enum(DIRECTIONS),
  amountIn: decimalBigint,
  chainId: z.literal(VAULT_CHAIN_IDS),
  address: addressField,
  connectorId: z.string().min(1),
  smartAccount: z.boolean(),
  submittedAt: z.number(),
  expiresAt: z.number(),
  vault: addressField,
  tokenIn: addressField,
  tokenOut: addressField,
};

const recordSchema = z.discriminatedUnion("kind", [
  z.object({
    ...baseFields,
    kind: z.literal("approve"),
    quotedOut: z.never().optional(),
    quotedFee: z.never().optional(),
  }),
  z.object({ ...baseFields, kind: z.literal("swap"), quotedOut: decimalBigint, quotedFee: decimalBigint }),
]);

// Anything on the origin can write localStorage, so the contracts a record names are checked against the pinned
// deployment instead of being trusted.
function matchesDeployment(r: VaultPendingRecord): boolean {
  const deployment = getVaultDeployment(r.chainId);
  if (!deployment) return false;
  const route = routeFor(deployment, r.direction);
  return (
    isAddressEqual(r.vault, deployment.vault) &&
    isAddressEqual(r.tokenIn, route.tokenIn) &&
    isAddressEqual(r.tokenOut, route.tokenOut)
  );
}

/** Reads a persisted record back. Anything that does not fit yields `undefined`, so it can never be resumed. */
export function parsePendingRecord(raw: string | null | undefined): VaultPendingRecord | undefined {
  if (!raw) return undefined;
  try {
    const result = recordSchema.safeParse(JSON.parse(raw));
    return result.success && matchesDeployment(result.data) ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function isPendingExpired(r: VaultPendingRecord, now: number): boolean {
  return now >= r.expiresAt;
}

/**
 * Live chain state wins over an approve record, but only an allowance for the record's own input token that was
 * read after submission counts: a read that has not run yet, or ran before the approval, describes the old state.
 * A swap has no live signal that proves it mined, so only its receipt settles it.
 */
export function shouldClearPending(r: VaultPendingRecord, live: VaultLiveState): boolean {
  if (r.kind !== "approve") return false;
  const allowance = live.allowances[r.direction];
  if (allowance?.value === undefined || allowance.updatedAt === undefined) return false;
  return allowance.updatedAt > r.submittedAt && allowance.value >= r.amountIn;
}

function localStorageOrUndefined(): Storage | undefined {
  // Reading `window.localStorage` itself throws when storage is blocked.
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * `window.localStorage`, resolved on every call. Without a window, or when storage is blocked or full, reads
 * return `null` and writes are dropped, so a storage failure never throws into the transaction flow; the record
 * then lives only in the store's memory and a reload cannot resume it.
 */
export function createPendingStorage(): PendingStorage {
  return Object.freeze({
    get(k: string): string | null {
      try {
        return localStorageOrUndefined()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    set(k: string, v: string): void {
      try {
        localStorageOrUndefined()?.setItem(k, v);
      } catch {
        // Quota or blocked storage.
      }
    },
    remove(k: string): void {
      try {
        localStorageOrUndefined()?.removeItem(k);
      } catch {
        // Blocked storage.
      }
    },
    subscribe(k: string, l: () => void): () => void {
      if (typeof window === "undefined") return () => {};
      const handler = (event: StorageEvent) => {
        // A null key is `localStorage.clear()`, which removes this key too.
        if (event.key === null || event.key === k) l();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  });
}

function belongsToContext(r: VaultPendingRecord, c: PendingContext): boolean {
  return (
    r.chainId === c.chainId && r.address.toLowerCase() === c.address.toLowerCase() && r.connectorId === c.connectorId
  );
}

/** A record stored under another context's key is treated like a corrupt one. */
function parseForContext(raw: string | null, c: PendingContext): VaultPendingRecord | undefined {
  const record = parsePendingRecord(raw);
  return record && belongsToContext(record, c) ? record : undefined;
}

/** Reads the record for a wallet context, removing it when it is corrupt or belongs to another context. */
export function readPendingRecord(s: PendingStorage, c: PendingContext): VaultPendingRecord | undefined {
  const key = pendingStorageKey(c);
  const raw = s.get(key);
  if (raw === null) return undefined;
  const record = parseForContext(raw, c);
  if (!record) s.remove(key);
  return record;
}

function sameHash(a: Hash | undefined, b: Hash | undefined): boolean {
  return a?.toLowerCase() === b?.toLowerCase();
}

/**
 * Compare-and-set write. Another tab may have submitted for the same wallet between this tab's read and its write;
 * the write is refused when a different transaction that is still being tracked is stored. An empty, unparseable
 * or expired slot is always writable: another tab may have dismissed the record this tab saw while the user was
 * signing, and the signed transaction is real either way. After writing, the slot is read back; a different hash
 * there means another tab wrote in between and this write lost.
 */
export function writePendingRecord(
  s: PendingStorage,
  r: VaultPendingRecord,
  expectedCurrentHash: Hash | undefined,
  now: number = Date.now()
): boolean {
  const key = pendingStorageKey(r);
  const current = parseForContext(s.get(key), r);
  if (current && !sameHash(current.hash, expectedCurrentHash) && !isPendingExpired(current, now)) return false;

  s.set(key, serializePendingRecord(r));
  // Storage that dropped the write reads back empty; that is not a lost race.
  const after = parseForContext(s.get(key), r);
  return after === undefined || sameHash(after.hash, r.hash);
}

/** Removes the record, unless `onlyIfHash` is given and a different transaction's record is stored. */
export function clearPendingRecord(s: PendingStorage, c: PendingContext, onlyIfHash?: Hash): void {
  const key = pendingStorageKey(c);
  if (onlyIfHash !== undefined) {
    const current = parseForContext(s.get(key), c);
    if (current && !sameHash(current.hash, onlyIfHash)) return;
  }
  s.remove(key);
}

/**
 * Smart accounts get the long TTL and no replacement check. Safe users usually arrive through WalletConnect, so
 * the connector id alone misses them; deployed bytecode catches them. An EIP-7702 delegation designator
 * (`0xef0100` and a 20-byte address) is an EOA that signs its own transactions.
 */
export function isSmartAccount(connectorId: string, code: Hex | undefined): boolean {
  if (connectorId === "safe") return true;
  if (!code || /^0x$/i.test(code)) return false;
  return !/^0xef0100[0-9a-f]{40}$/i.test(code);
}
