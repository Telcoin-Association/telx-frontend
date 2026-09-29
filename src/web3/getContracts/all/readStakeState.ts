import { Contract, ethers, formatUnits } from "ethers";
import TOKEN_ABI from "@/web3/abis/token.json";
import { provider } from "@/lib/ethersProvider";
import { getPoolContractValues } from "./getPoolContractValues";

/** Pool-wide staking figures: the same for every visitor. */
export type PoolStakeTotals = {
  totalSupply: number;
  totalStaked: number;
  stakedLiquidity: number | null;
  currentTotalStakeAmount: number;
};

export type StakeState = {
  poolContract: Contract;
  /** The connected wallet's unstaked LP tokens, 0 without a wallet. */
  walletLPT: number;
  /** The wallet's LP tokens in this staking contract, 0 without a wallet. */
  walletStakedLPT: number;
  /** Null when the totals were not needed, see readStakeState. */
  totals: PoolStakeTotals | null;
};

/**
 * Reads a legacy staking pool (Balancer, QuickSwap, DFX): the connected wallet's LP balance and stake, and
 * the pool-wide totals.
 *
 * The totals cost three RPC reads that are the same for every visitor, so they are read only for an active
 * pool, or when the wallet has a stake in this contract whose USD value and reward share depend on them. An
 * inactive pool therefore costs nothing without a wallet, and two reads per staking contract with one.
 * `totalLiquidity` is resolved only when the totals are read, since pricing it can cost reads of its own.
 *
 * A failed wallet read is logged and reads as no balance, so one staking contract cannot fail the whole load.
 */
export async function readStakeState({
  poolAddress,
  stakeAddress,
  stakeContract,
  wallet,
  includeTotals,
  totalLiquidity,
}: {
  poolAddress: string;
  stakeAddress: string;
  stakeContract: Contract;
  wallet: string | undefined;
  includeTotals: boolean;
  totalLiquidity: () => Promise<number | null>;
}): Promise<StakeState> {
  const poolContract = new ethers.Contract(poolAddress, TOKEN_ABI, provider);

  let walletLPT = 0;
  let walletStakedLPT = 0;
  if (wallet) {
    try {
      const [rawLPT, rawStaked] = await Promise.all([poolContract.balanceOf(wallet), stakeContract.balanceOf(wallet)]);
      walletLPT = Number(formatUnits(rawLPT, 18));
      walletStakedLPT = Number(formatUnits(rawStaked, 18));
    } catch (error) {
      console.error(`Wallet stake read failed for staking contract ${stakeAddress}`, error);
    }
  }

  if (!includeTotals && !(walletStakedLPT > 0)) {
    return { poolContract, walletLPT, walletStakedLPT, totals: null };
  }

  const liquidity = await totalLiquidity();
  const { totalSupply, totalStaked, stakedLiquidity, currentTotalStakeAmount } = await getPoolContractValues({
    poolAddress,
    stakeAddress,
    stakeContract,
    totalLiquidity: liquidity ?? 0,
  });
  return {
    poolContract,
    walletLPT,
    walletStakedLPT,
    totals: { totalSupply, totalStaked, stakedLiquidity, currentTotalStakeAmount },
  };
}

/** A wallet stake's share of the staking contract, 0 when either side is unknown or empty. */
export function stakeShare(walletStakedLPT: number, totals: PoolStakeTotals | null): number {
  if (!totals || !(totals.currentTotalStakeAmount > 0)) return 0;
  return walletStakedLPT / totals.currentTotalStakeAmount;
}

/** The USD value of a wallet stake, 0 when the pool's staked liquidity is unknown. */
export function stakedValueUSD(walletStakedLPT: number, totals: PoolStakeTotals | null): number {
  if (!totals || totals.stakedLiquidity === null || !(totals.totalStaked > 0)) return 0;
  return totals.stakedLiquidity * (walletStakedLPT / totals.totalStaked);
}
