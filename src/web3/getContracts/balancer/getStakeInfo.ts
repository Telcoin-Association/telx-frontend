import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType, createStakingContract } from "../all/createStakingContract";
import { readStakeState } from "../all/readStakeState";
import { getRewardsValues } from "./getRewardsValues";

export async function getStakeInfo(
  stakeAddress: string,
  poolAddress: string,
  type: ContractType,
  totalLiquidity: () => Promise<number | null>,
  value: miningContract,
  selectedWalletAddress: string | undefined,
) {
  const stakeContract = await createStakingContract(type, stakeAddress);

  const { walletLPT, walletStakedLPT, totals } = await readStakeState({
    poolAddress,
    stakeAddress,
    stakeContract,
    wallet: selectedWalletAddress,
    includeTotals: value.active,
    totalLiquidity,
  });

  const { balanceLPT, stakedLPT, stakedUSD, rewards } = await getRewardsValues({
    selectedWalletAddress,
    stakeAddress,
    stakeContract,
    walletLPT,
    walletStakedLPT,
    totals,
    type,
    rewardsInfo: value.rewards,
  });

  return {
    balanceLPT,
    stakedLPT,
    stakedUSD,
    stakedLiquidity: totals?.stakedLiquidity ?? null,
    rewards,
    totalSupply: totals?.totalSupply ?? null,
    totalStaked: totals?.totalStaked ?? null,
  };
}
