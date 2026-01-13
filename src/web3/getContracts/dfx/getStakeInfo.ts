import {
  ContractType,
  createStakingContract,
} from "../all/createStakingContract";
import { getPoolContractValues } from "../all/getPoolContractValues";
import TOKEN_INFO from "../../token_info";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { Reward } from "../quickswap/getStakeInfo";
import { formatUnits } from "ethers";

export async function dfxGetStakeInfo(
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
  // let pendingTelRewards = 0;
  let pendingDFXRewards: number;

  if (selectedWalletAddress) {
    try {
      const [rawBalanceLPT, rawStakedLPT, rawPendingRewards] =
        await Promise.all([
          poolContract.balanceOf(selectedWalletAddress),
          stakeContract.balanceOf(selectedWalletAddress),
          stakeContract.earned(selectedWalletAddress),
        ]);

      // Convert BigNumber values to numbers
      balanceLPT = Number(formatUnits(rawBalanceLPT, 18));
      balanceLPTString = formatUnits(rawBalanceLPT, 18);

      currentUserStakeAmount = Number(formatUnits(rawStakedLPT, 18));
      stakedLPT = currentUserStakeAmount;
      stakedLPTString = `${stakedLPT}`;

      if (stakedLiquidity !== null) {
        stakedUSD = stakedLiquidity * (stakedLPT / totalStaked);
      }

      poolContributionRatio = currentUserStakeAmount / currentTotalStakeAmount;
      // Handle DFX rewards (assuming rawPendingRewards is a BigNumber)
      pendingDFXRewards = parseFloat(formatUnits(rawPendingRewards[0], 18));
    } catch (error) {
      console.error("Error fetching DFX stake info:", error);
    }
  }

  // rewards
  const rewards: Reward[] = [];
  value.rewards.tokens.map((rewardData) => {
    const reward = {} as Reward;

    switch (rewardData.ticker) {
      case "DFX Finance":
      case "DFX":
      case "DFX ticker":
      case "DFX Ticker":
        reward.name = TOKEN_INFO.dfx.name;
        reward.ticker = TOKEN_INFO.dfx.ticker;
        reward.image = TOKEN_INFO.dfx.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = pendingDFXRewards;
        reward.weeklyUser = poolContributionRatio * rewardData.amount;
        break;

      default:
        // default is TEL
        reward.name = TOKEN_INFO.tel.name;
        reward.ticker = TOKEN_INFO.tel.ticker;
        reward.image = TOKEN_INFO.tel.image;
        reward.amount = rewardData.amount;
        // this will be an estimate because the contract only returns DFX rewards
        // TEL rewards are airdropped to the user for DFX pools
        (reward.unclaimed = 0),
          (reward.weeklyUser =
            (stakedUSD * rewardData.amount) / totalLiquidity);
        break;
    }
    rewards.push(reward);
  });

  return {
    balanceLPT: balanceLPT,
    stakedLPT: stakedLPTString,
    stakedUSD: stakedUSD,
    stakedLiquidity: stakedLiquidity,
    rewards: rewards,
    totalStaked,
    totalSupply,
  };
}
