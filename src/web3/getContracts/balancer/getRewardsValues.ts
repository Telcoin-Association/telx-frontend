import { miningContract } from "../../../helpers/normalizeMiningContracts";
import TOKEN_INFO from "../../token_info";
import { Reward } from "../quickswap/getStakeInfo";
import { ContractType } from "../all/createStakingContract";
import { STAKE_ADDRESS_TEL_DFX } from "@/lib/constants";
import { Contract, formatUnits } from "ethers";

interface GetRewardsValuesProps {
  selectedWalletAddress?: string;
  poolContract: Contract;
  stakeAddress: string;
  stakeContract: Contract;
  stakedLiquidity: number | null;
  totalStaked: number;
  currentTotalStakeAmount: number;
  type: ContractType;
  rewardsInfo: miningContract["rewards"];
}

interface RewardsValuesResult {
  balanceLPT: string;
  stakedLPT: string;
  stakedUSD: number;
  rewards: Reward[];
}

export const getRewardsValues = async (
  props: GetRewardsValuesProps
): Promise<RewardsValuesResult> => {
  const {
    selectedWalletAddress,
    poolContract,
    stakeAddress,
    stakeContract,
    stakedLiquidity,
    totalStaked,
    currentTotalStakeAmount,
    type,
    rewardsInfo,
  } = props;

  let balanceLPT = 0;
  let stakedLPT = 0;
  let stakedUSD = 0;
  let currentUserStakeAmount = 0;
  let poolContributionRatio = 0;
  let pendingTelRewards = 0;
  let pendingSecondaryRewards = 0;

  if (selectedWalletAddress) {
    try {
      const [rawBalanceLPT, rawStakedLPT] = await Promise.all([
        poolContract.balanceOf(selectedWalletAddress),
        stakeContract.balanceOf(selectedWalletAddress),
      ]);

      // Convert BigNumbers to numbers
      balanceLPT = Number(formatUnits(rawBalanceLPT, 18));
      currentUserStakeAmount = Number(formatUnits(rawStakedLPT, 18));
      stakedLPT = currentUserStakeAmount;

      stakedUSD = stakedLiquidity
        ? stakedLiquidity * (stakedLPT / totalStaked)
        : 0;

      poolContributionRatio = currentUserStakeAmount / currentTotalStakeAmount;

      // Handle rewards based on contract type
      if (type === "single") {
        const rawTelRewards = await stakeContract.earned(selectedWalletAddress);
        pendingTelRewards = Number(formatUnits(rawTelRewards, 2));
      } else if (type === "multi") {
        const [secondaryRewards, telRewards] = await stakeContract.earned(
          selectedWalletAddress
        );
        pendingTelRewards = Number(formatUnits(telRewards, 18));
        pendingSecondaryRewards = Number(formatUnits(secondaryRewards, 18));
      }

      // Special case handling
      if (stakeAddress === STAKE_ADDRESS_TEL_DFX) {
        const rawDfxRewards = await stakeContract.earnedA(
          selectedWalletAddress
        );
        pendingSecondaryRewards = Number(formatUnits(rawDfxRewards, 18));
      }
    } catch (error) {
      console.error("Error fetching rewards values:", error);
    }
  }

  const rewards: Reward[] = [];
  rewardsInfo?.tokens?.forEach((rewardData) => {
    const reward: Reward = {
      name: "",
      ticker: "",
      image: "",
      amount: rewardData.amount,
      unclaimed: 0,
      weeklyUser: poolContributionRatio * rewardData.amount || 0,
    };

    switch (rewardData.ticker.toLowerCase()) {
      case "dfx":
        reward.name = TOKEN_INFO.dfx.name;
        reward.ticker = TOKEN_INFO.dfx.ticker;
        reward.image = TOKEN_INFO.dfx.image;
        reward.unclaimed = pendingSecondaryRewards;
        break;

      default:
        // Default to TEL rewards
        reward.name = TOKEN_INFO.tel.name;
        reward.ticker = TOKEN_INFO.tel.ticker;
        reward.image = TOKEN_INFO.tel.image;
        reward.unclaimed =
          stakeAddress === STAKE_ADDRESS_TEL_DFX ? 0 : pendingTelRewards;
        break;
    }
    rewards.push(reward);
  });

  return {
    balanceLPT: balanceLPT.toFixed(18),
    stakedLPT: stakedLPT.toFixed(18),
    stakedUSD,
    rewards,
  };
};

interface AirdroppedReward extends Omit<Reward, "unclaimed" | "weeklyUser"> {
  unclaimed?: never;
  weeklyUser?: never;
}

export const getRewardsValuesNoStakingContract = async (props: {
  rewardsInfo: miningContract["rewards"];
}): Promise<AirdroppedReward[]> => {
  const { rewardsInfo } = props;
  const rewards: any[] = [];

  rewardsInfo?.tokens?.forEach((rewardData) => {
    const baseReward = {
      amount: rewardData.amount,
      unclaimed: 0,
      weeklyUser: 0,
    };

    switch (rewardData.ticker.toLowerCase()) {
      case "bal":
        rewards.push({
          ...baseReward,
          name: TOKEN_INFO.bal.name,
          ticker: TOKEN_INFO.bal.ticker,
          image: TOKEN_INFO.bal.image,
        });
        break;

      case "dfx":
        rewards.push({
          ...baseReward,
          name: TOKEN_INFO.dfx.name,
          ticker: TOKEN_INFO.dfx.ticker,
          image: TOKEN_INFO.dfx.image,
        });
        break;

      default:
        rewards.push({
          ...baseReward,
          name: TOKEN_INFO.tel.name,
          ticker: TOKEN_INFO.tel.ticker,
          image: TOKEN_INFO.tel.image,
        });
        break;
    }
  });

  return rewards;
};
