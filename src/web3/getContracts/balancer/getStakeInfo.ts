import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType, createStakingContract } from "../all/createStakingContract";
import { getPoolContractValues } from "../all/getPoolContractValues";
import { getRewardsValues } from "./getRewardsValues";

export async function getStakeInfo(
  stakeAddress: string,
  poolAddress: string,
  type: ContractType,
  totalLiquidity: number,
  value: miningContract,
  selectedWalletAddress: string | undefined,
) {
  const stakeContract = await createStakingContract(type, stakeAddress);

  const poolContractValues = await getPoolContractValues({
    poolAddress: poolAddress,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    totalLiquidity: totalLiquidity,
  });
  const { totalStaked, stakedLiquidity, currentTotalStakeAmount, poolContract, totalSupply } = poolContractValues;

  const rewardsValues = await getRewardsValues({
    selectedWalletAddress: selectedWalletAddress,
    poolContract: poolContract,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    stakedLiquidity: stakedLiquidity,
    totalStaked: totalStaked,
    currentTotalStakeAmount: currentTotalStakeAmount,
    type: type,
    rewardsInfo: value.rewards,
  });

  const { balanceLPT, stakedLPT, stakedUSD, rewards } = rewardsValues || {
    balanceLPT: undefined,
    stakedLPT: undefined,
    stakedUSD: undefined,
    rewards: undefined,
  };

  return {
    balanceLPT,
    stakedLPT,
    stakedUSD,
    stakedLiquidity,
    rewards,
    totalSupply,
    totalStaked,
  };
}
