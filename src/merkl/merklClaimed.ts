/**
 * Onchain claimed amounts for Merkl rewards.
 *
 * Merkl's API reports `claimed` from its own index, which can trail a claim by minutes. The Distributor's
 * `claimed(user, token)` view is the source of truth, so these helpers read it and raise Merkl's values to
 * match. The proxy route and the client service both use them, so the rule lives in one place.
 */

import { formatUnits, isAddress, type PublicClient } from "viem";
import { MERKL_DISTRIBUTOR_ABI, MERKL_DISTRIBUTOR_ADDRESS } from "./merklConstants";
import type { MerklChainRewardsResponse, MerklRewardEntry, MerklToken } from "./merklTypes";

/** Most tokens read per call; a TELx user has one or two, so anything past this is not worth the reads. */
export const MAX_CLAIMED_TOKENS = 10;

/** Time each `claimed` read gets before it counts as failed, so a slow RPC cannot hold up the rewards. */
export const CLAIMED_READ_TIMEOUT_MS = 3_000;

/** Cumulative claimed amounts in wei, keyed by chain id, then by lowercase token address. */
export type ClaimedByChain = Record<number, Record<string, bigint>>;

/** The part of a viem public client the reads need. */
export type ClaimedReader = Pick<PublicClient, "readContract">;

export interface ClaimedRead {
  /** Cumulative claimed amount in wei per lowercase token address, for the reads that succeeded. */
  claimed: Record<string, bigint>;
  /** What each failed read threw or rejected with. The caller decides how to log it. */
  failures: unknown[];
}

/** Rejects with a timeout error when `promise` has not settled within `ms`, and clears its timer either way. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Merkl claimed read timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The cumulative amount of `token` that `user` has claimed from the Distributor. */
async function readClaimed(client: ClaimedReader, user: `0x${string}`, token: `0x${string}`): Promise<bigint> {
  const [amount] = await client.readContract({
    address: MERKL_DISTRIBUTOR_ADDRESS,
    abi: MERKL_DISTRIBUTOR_ABI,
    functionName: "claimed",
    args: [user, token],
  });
  return amount;
}

/**
 * Reads the Distributor's cumulative claimed amount for each distinct valid token, at most
 * MAX_CLAIMED_TOKENS of them, concurrently and with CLAIMED_READ_TIMEOUT_MS each. A read that fails or
 * times out is returned in `failures` and has no entry in `claimed`. It never throws.
 */
export async function readClaimedAmounts(
  client: ClaimedReader,
  user: `0x${string}`,
  tokens: readonly string[]
): Promise<ClaimedRead> {
  const distinct = [
    ...new Set(tokens.filter((token) => typeof token === "string").map((token) => token.toLowerCase())),
  ]
    .filter((token): token is `0x${string}` => isAddress(token))
    .slice(0, MAX_CLAIMED_TOKENS);

  const results = await Promise.allSettled(
    distinct.map((token) => withTimeout(readClaimed(client, user, token), CLAIMED_READ_TIMEOUT_MS))
  );

  const claimed: Record<string, bigint> = {};
  const failures: unknown[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") claimed[distinct[index]] = result.value;
    else failures.push(result.reason);
  });
  return { claimed, failures };
}

/** A wei amount as Merkl sends it. Missing or empty counts as 0; anything that is not an integer is null. */
function parseWei(value: string | undefined): bigint | null {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** `record[key]` when it is an own bigint. Keys come from Merkl, so "constructor" must not read an inherited value. */
function ownBigint(record: Record<string, bigint>, key: string): bigint | undefined {
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  return typeof value === "bigint" ? value : undefined;
}

/**
 * `wei` of `token` in USD, or 0 when Merkl's `decimals` or `price` cannot be used. ERC-20 decimals is a
 * uint8 and formatUnits throws on a huge or fractional value; a price that is not a positive finite number
 * would make the result NaN.
 */
function weiToUSD(wei: bigint, token: MerklToken): number {
  const { decimals, price } = token;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return 0;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return 0;
  return Number(formatUnits(wei, decimals)) * price;
}

/** True when the reward's `claimed` covers its `amount`. */
function isFullyClaimed(reward: MerklRewardEntry): boolean {
  const amount = parseWei(reward.amount);
  const claimed = parseWei(reward.claimed);
  return amount != null && claimed != null && claimed >= amount;
}

/**
 * Raises each reward's `claimed` to the onchain amount in `claimedByChain` when that is larger. It never
 * lowers a value and leaves `amount`, `pending` and `proofs` alone. When a reward on a chain entry was
 * raised, the entry's `claimedUSD` is corrected too: it equals `amountUSD` once every reward on the entry
 * is fully claimed, and otherwise grows by the raised amount at the token's price, never past `amountUSD`.
 * A reward whose `decimals` or `price` cannot be used adds nothing to it, though its `claimed` is still raised.
 * Pure: entries that change are copies, and the rest are returned as they were.
 */
export function applyClaimedAmounts(
  data: MerklChainRewardsResponse[],
  claimedByChain: ClaimedByChain
): MerklChainRewardsResponse[] {
  if (!Array.isArray(data)) return data;

  return data.map((entry) => {
    const chainId = entry?.chain?.id;
    const onchain = Object.hasOwn(claimedByChain, chainId) ? claimedByChain[chainId] : undefined;
    if (!onchain || !Array.isArray(entry.rewards)) return entry;

    let raised = false;
    let raisedUSD = 0;
    const rewards = entry.rewards.map((reward) => {
      const address = reward?.token?.address;
      const onchainClaimed = typeof address === "string" ? ownBigint(onchain, address.toLowerCase()) : undefined;
      if (onchainClaimed === undefined) return reward;

      const claimed = parseWei(reward.claimed);
      const amount = parseWei(reward.amount);
      if (claimed == null || amount == null || onchainClaimed <= claimed) return reward;

      raised = true;
      const counted = (onchainClaimed < amount ? onchainClaimed : amount) - claimed;
      if (counted > 0n) raisedUSD += weiToUSD(counted, reward.token);
      return { ...reward, claimed: onchainClaimed.toString() };
    });

    if (!raised) return entry;
    const corrected: MerklChainRewardsResponse = { ...entry, rewards };

    const amountUSD = Number(entry.amountUSD);
    if (entry.amountUSD && Number.isFinite(amountUSD)) {
      if (rewards.every(isFullyClaimed)) {
        corrected.claimedUSD = entry.amountUSD;
      } else {
        const claimedUSD = Number(entry.claimedUSD || "0");
        const base = Number.isFinite(claimedUSD) ? claimedUSD : 0;
        corrected.claimedUSD = String(Math.min(base + raisedUSD, amountUSD));
      }
    }
    return corrected;
  });
}
