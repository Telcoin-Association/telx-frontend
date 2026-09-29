import { miningContract } from "../../../helpers/normalizeMiningContracts";
import TOKEN_INFO from "../../token_info";
import {
  ContractType,
  createStakingContract,
} from "../all/createStakingContract";
import { readStakeState, stakedValueUSD, stakeShare } from "../all/readStakeState";
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
  totalLiquidity: () => Promise<number | null>,
  value: miningContract,
  selectedWalletAddress: string | undefined
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

  const balanceLPTString = walletLPT.toFixed(18);
  const stakedLPTString = walletStakedLPT.toFixed(18);
  const stakedUSD = stakedValueUSD(walletStakedLPT, totals);
  const poolContributionRatio = stakeShare(walletStakedLPT, totals);
  let pendingTelRewards = 0;
  let pendingQuickRewards = 0;

  if (selectedWalletAddress) {
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
    stakedLiquidity: totals?.stakedLiquidity ?? null,
    rewards: rewards,
    totalSupply: totals?.totalSupply ?? null,
    totalStaked: totals?.totalStaked ?? null,
  };
}
