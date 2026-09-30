import BigNumber from "bignumber.js";

/**
 * Whether a wallet still has something in a staking pool: LP tokens staked, or rewards left to claim. Used to
 * keep deprecated pools on the Portfolio page for as long as their stakers need them.
 */

const isPositive = (value: unknown): boolean => {
  if (value === null || value === undefined || value === "") return false;
  const amount = new BigNumber(typeof value === "bigint" ? value.toString() : String(value));
  return amount.isFinite() && amount.isGreaterThan(0);
};

/**
 * Whether the connected wallet has LP tokens staked in the pool, in its current staking contract or in
 * one it has retired. Checked for every pool, active or not: a deprecated pool keeps its stakers until
 * they claim and unstake, so it must stay reachable from Portfolio whatever the pool's listing flags say.
 */
export const hasUserStake = (contract: any): boolean =>
  isPositive(contract?.user?.stakedLPT) || isPositive(contract?.user?.deprecated?.stakedLPT);

const anyUnclaimed = (rewards: unknown): boolean =>
  Array.isArray(rewards) && rewards.some((reward: any) => isPositive(reward?.unclaimed));

/**
 * Whether the connected wallet has rewards left to claim in the pool's current or retired staking contract.
 * A wallet can withdraw its LP tokens without claiming, so rewards can outlive the stake.
 */
export const hasUnclaimedRewards = (contract: any): boolean =>
  anyUnclaimed(contract?.rewards) || anyUnclaimed(contract?.user?.deprecated?.rewards);

/** Whether the pool belongs on the wallet's Portfolio: it has a stake or rewards to claim there. */
export const hasUserHoldings = (contract: any): boolean => hasUserStake(contract) || hasUnclaimedRewards(contract);
