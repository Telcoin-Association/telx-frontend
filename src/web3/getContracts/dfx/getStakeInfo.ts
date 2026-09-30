import {
  ContractType,
  createStakingContract,
} from "../all/createStakingContract";
import { readStakeState, stakedValueUSD, stakeShare } from "../all/readStakeState";
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

  const { walletLPT, walletStakedLPT, walletReadFailed, totals } = await readStakeState({
    poolAddress,
    stakeAddress,
    stakeContract,
    wallet: selectedWalletAddress,
    includeTotals: value.active,
    totalLiquidity: () => Promise.resolve(totalLiquidity),
  });

  const balanceLPT = walletLPT;
  const stakedLPTString = `${walletStakedLPT}`;
  const stakedUSD = stakedValueUSD(walletStakedLPT, totals);
  const poolContributionRatio = stakeShare(walletStakedLPT, totals);
  let pendingDFXRewards = 0;
  let rewardsReadFailed = false;

  if (selectedWalletAddress) {
    try {
      const rawPendingRewards = await stakeContract.earned(selectedWalletAddress);
      pendingDFXRewards = parseFloat(formatUnits(rawPendingRewards[0], 18));
    } catch (error) {
      console.error("Error fetching DFX stake info:", error);
      rewardsReadFailed = true;
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
        reward.unclaimed = 0;
        reward.weeklyUser = totalLiquidity > 0 ? (stakedUSD * rewardData.amount) / totalLiquidity : 0;
        break;
    }
    rewards.push(reward);
  });

  return {
    balanceLPT: balanceLPT,
    stakedLPT: stakedLPTString,
    stakedUSD: stakedUSD,
    stakedLiquidity: totals?.stakedLiquidity ?? null,
    rewards: rewards,
    totalStaked: totals?.totalStaked ?? null,
    totalSupply: totals?.totalSupply ?? null,
    readFailed: walletReadFailed || rewardsReadFailed,
  };
}
