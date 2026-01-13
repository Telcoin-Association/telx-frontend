import TOKEN_ABI from "@/web3/abis/token.json";
import { Contract, ethers } from "ethers";
import { provider } from "@/lib/alchemySdk";

interface GetPoolContractValuesProps {
  poolAddress: string;
  stakeAddress: string;
  totalLiquidity: number;
  stakeContract: Contract;
}

export const getPoolContractValues = async (
  props: GetPoolContractValuesProps
) => {
  const { poolAddress, stakeAddress, totalLiquidity, stakeContract } = props;

  const poolContract = new ethers.Contract(poolAddress, TOKEN_ABI, provider);

  const [totalSupply, totalStaked, currentTotalStakeAmount] = await Promise.all([
    poolContract.totalSupply(),
    poolContract.balanceOf(stakeAddress),
    stakeContract.totalSupply(),
  ]);

  // Convert to string/number using formatUnits
  const formattedTotalSupply = parseFloat(ethers.formatUnits(totalSupply, 18));
  const formattedTotalStaked = parseFloat(ethers.formatUnits(totalStaked, 18));
  const formattedStakeTotal = parseFloat(ethers.formatUnits(currentTotalStakeAmount, 18));

  const stakedLiquidity =
    totalLiquidity && formattedTotalSupply > 0
      ? (formattedTotalStaked / formattedTotalSupply) * totalLiquidity
      : null;

  return {
    totalSupply: formattedTotalSupply,
    totalStaked: formattedTotalStaked,
    stakedLiquidity: stakedLiquidity,
    currentTotalStakeAmount: formattedStakeTotal,
    poolContract,
  };
};
