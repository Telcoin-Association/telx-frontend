import "server-only";

import type { PoolRewardsIndex } from "@/lib/positions";
import { TEL_V3 } from "./poolRewards";

/**
 * The TELx rewards one position has earned, as its history shows them, taken from its pool's rewards index (see
 * poolRewards.ts): everything credited plus everything accrued, whether or not it has been claimed.
 */
export type PositionRewards = {
  /** Reward token symbol. */
  symbol: string;
  /** Reward token address, lowercase. */
  token: string;
  /** Whole tokens earned. */
  amount: number;
  /** A USD price for the token when the caller has none of its own, or null. */
  priceUSD: number | null;
  /** True once every campaign the reward comes from is settled. */
  final: boolean;
};

/** A position's rewards from its pool's index. A position the index doesn't list has earned nothing yet. */
export function positionRewardsFromIndex(index: PoolRewardsIndex, tokenId: string): PositionRewards {
  const entry = index.positions[tokenId];
  return { symbol: "TEL", token: TEL_V3, amount: entry?.reward ?? 0, priceUSD: null, final: entry?.final ?? true };
}
