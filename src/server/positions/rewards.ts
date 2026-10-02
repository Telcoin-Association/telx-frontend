import "server-only";

import { z } from "zod";

import type { RpcChain } from "@/lib/rpc";
import { CHAIN_IDS, MERKL_API } from "@/server/pools/merkl/fetch";

/**
 * The TELx rewards one position has earned, from Merkl's per-user rewards. Merkl attributes Uniswap v4
 * subscription rewards to each position: every breakdown's `reason` names the position as
 * `…_tokenId_<id>_…`. A breakdown's `amount` is what Merkl has credited so far (claimed or not) and `pending`
 * what has accrued since its last update, so their sum is everything the position has earned, across every
 * campaign it took part in.
 *
 * Rewards follow the wallet that held the position while they accrued, so they are read for its current owner.
 */

export type PositionRewards = {
  /** Reward token symbol, as Merkl names it. */
  symbol: string;
  /** Reward token address, lowercase. */
  token: string;
  /** Whole tokens earned. */
  amount: number;
  /** Merkl's current USD price for the token, or null when it has none. */
  priceUSD: number | null;
};

const FETCH_TIMEOUT_MS = 10_000;

const Breakdown = z.object({ reason: z.string(), amount: z.string(), pending: z.string().nullish(), campaignId: z.string().nullish() });
const Reward = z.object({
  token: z.object({ address: z.string(), symbol: z.string(), decimals: z.number(), price: z.number().nullish() }),
  breakdowns: z.array(Breakdown),
});
const UserRewards = z.array(z.object({ chain: z.object({ id: z.number() }), rewards: z.array(Reward) }));

/** Whole tokens from a base-unit decimal string, without losing the integer part to float rounding. */
function units(value: string, decimals: number): number {
  const raw = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  return Number(raw / scale) + Number(raw % scale) / Number(scale);
}

/** True when a Merkl `reason` names this position, for example `MultiLogPerAdditionalParam_tokenId_143904_714…`. */
export const reasonNamesToken = (reason: string, tokenId: string) => reason.includes(`_tokenId_${tokenId}_`) || reason.endsWith(`_tokenId_${tokenId}`);

/**
 * Sums a position's TEL rewards from Merkl's user rewards response, counting each breakdown once per campaign.
 * Only TEL rewards count: they are the TELx incentives, and they keep a position's figure from mixing in another
 * program's tokens.
 */
export function sumPositionRewards(body: unknown, chainId: number, tokenId: string): PositionRewards | null {
  const parsed = UserRewards.safeParse(body);
  if (!parsed.success) return null;
  let total: PositionRewards | null = null;
  const seen = new Set<string>();
  for (const entry of parsed.data) {
    if (entry.chain.id !== chainId) continue;
    for (const reward of entry.rewards) {
      if (reward.token.symbol.toUpperCase() !== "TEL") continue;
      for (const breakdown of reward.breakdowns) {
        if (!reasonNamesToken(breakdown.reason, tokenId)) continue;
        const key = `${breakdown.reason}|${breakdown.campaignId ?? ""}|${reward.token.address.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const earned = units(breakdown.amount, reward.token.decimals) + units(breakdown.pending || "0", reward.token.decimals);
        total ??= { symbol: reward.token.symbol, token: reward.token.address.toLowerCase(), amount: 0, priceUSD: reward.token.price ?? null };
        total.amount += earned;
      }
    }
  }
  return total;
}

/**
 * Reads a position's earned TEL from Merkl for its owner. Returns a zero amount when the owner has rewards but
 * none name this position, and null when Merkl can't be read.
 */
export async function fetchPositionRewards(chain: RpcChain, owner: string, tokenId: string, fetchImpl: typeof fetch = fetch): Promise<PositionRewards | null> {
  const chainId = CHAIN_IDS[chain];
  const response = await fetchImpl(`${MERKL_API}/users/${owner}/rewards?chainId=${chainId}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!UserRewards.safeParse(body).success) return null;
  return sumPositionRewards(body, chainId, tokenId) ?? { symbol: "TEL", token: "", amount: 0, priceUSD: null };
}
