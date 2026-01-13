import { miningContract } from "../../../helpers/normalizeMiningContracts";
import TOKEN_INFO from "../../token_info";
import {
  ContractType,
  createStakingContract,
} from "../all/createStakingContract";
import { getPoolContractValues } from "../all/getPoolContractValues";
import { formatUnits } from "ethers";

export interface Reward {
  name: string;
  ticker: string;
  image: string;
  amount: number;
  unclaimed: number;
  weeklyUser: number;
}

export async function quickswapGetStakeInfo(
  stakeAddress: string,
  poolAddress: string,
  type: ContractType,
  totalLiquidity: number,
  value: miningContract,
  selectedWalletAddress: string | undefined
) {
  const stakeContract = await createStakingContract(type, stakeAddress);

  const poolContractValues = await getPoolContractValues({
    poolAddress: poolAddress,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    totalLiquidity: totalLiquidity,
  });
  const {
    totalStaked,
    stakedLiquidity,
    currentTotalStakeAmount,
    poolContract,
    totalSupply,
  } = poolContractValues;

  // stake info from pools
  let balanceLPT = 0;
  let stakedLPT = 0;
  let stakedUSD = 0;

  let balanceLPTString = "0";
  let stakedLPTString = "0";

  let currentUserStakeAmount = 0;
  let poolContributionRatio = 0;
  let pendingTelRewards = 0;
  let pendingQuickRewards = 0;

  if (selectedWalletAddress) {
    // balances
    const [rawBalanceLPT, rawStakedLPT] = await Promise.all([
      poolContract.balanceOf(selectedWalletAddress),
      stakeContract.balanceOf(selectedWalletAddress),
    ]);

    balanceLPT = Number(formatUnits(rawBalanceLPT, 18));
    balanceLPTString = balanceLPT.toFixed(18);
    
    currentUserStakeAmount = Number(formatUnits(rawStakedLPT, 18));
    stakedLPT = currentUserStakeAmount;
    stakedLPTString = stakedLPT.toFixed(18);

    if (stakedLiquidity !== null) {
      stakedUSD = stakedLiquidity * (stakedLPT / totalStaked);
    }
    poolContributionRatio = currentUserStakeAmount / currentTotalStakeAmount;
    

    // current rewards
    if (type === "single") {
      const rawTelRewards = await stakeContract.earned(selectedWalletAddress);
      pendingTelRewards = Number(formatUnits(rawTelRewards, 2));
    } else {
      const [rawTel, rawQuick] = await Promise.all([
        stakeContract.earnedA(selectedWalletAddress),
        stakeContract.earnedB(selectedWalletAddress),
      ]);
      pendingTelRewards = Number(formatUnits(rawTel, 2));
      pendingQuickRewards = Number(formatUnits(rawQuick, 18));
    }
  }

  //rewards
  const rewards: Reward[] = [];
  value?.rewards?.tokens?.map((rewardData) => {
    const reward = {} as Reward;
    switch (rewardData.ticker.toLowerCase()) {
      case "quick":
        reward.name = TOKEN_INFO.quick.name;
        reward.ticker = TOKEN_INFO.quick.ticker;
        reward.image = TOKEN_INFO.quick.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = pendingQuickRewards;
        reward.weeklyUser = poolContributionRatio * rewardData.amount;
        break;

      case "dquick":
        reward.name = TOKEN_INFO.dquick.name;
        reward.ticker = TOKEN_INFO.dquick.ticker;
        reward.image = TOKEN_INFO.dquick.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = pendingQuickRewards;
        reward.weeklyUser = poolContributionRatio * rewardData.amount;
        break;

      default:
        // default is TEL
        reward.name = TOKEN_INFO.tel.name;
        reward.ticker = TOKEN_INFO.tel.ticker;
        reward.image = TOKEN_INFO.tel.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = pendingTelRewards;
        reward.weeklyUser = poolContributionRatio * rewardData.amount;
        break;
    }
    rewards.push(reward);
  });
  return {
    balanceLPT: balanceLPTString,
    stakedLPT: stakedLPTString,
    stakedUSD: stakedUSD,
    stakedLiquidity: stakedLiquidity,
    rewards: rewards,
    totalSupply,
    totalStaked,
  };
}
