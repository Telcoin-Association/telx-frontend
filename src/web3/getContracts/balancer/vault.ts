import { provider } from "@/lib/ethersProvider";
import { Contract, ethers } from "ethers";
import VAULT_ABI from "@/web3/abis/balancer/vault.json";

export const getPoolLiquidityValue = async (
  poolId: string,
  tokenDecimals: Record<string, number>,
  tokenPrices: Record<string, number>
) => {
  const vaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const vaultContract = new Contract(vaultAddress, VAULT_ABI, provider);
  // Get pool tokens and balances
  const { tokens, balances } = await vaultContract.getPoolTokens(poolId);
  const normalizedTokens = tokens.map((token: string) => token.toLowerCase());

  let totalLiquidityUSD = 0;

  normalizedTokens.forEach((token: number, index: number) => {
    const decimals = tokenDecimals[token];
    const balance = parseFloat(ethers.formatUnits(balances[index], decimals));
    const valueUSD = balance * tokenPrices[token];
    totalLiquidityUSD += valueUSD;
  });

  return totalLiquidityUSD;
};
