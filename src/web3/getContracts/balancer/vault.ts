import { provider } from "@/lib/alchemySdk";
import { Contract, ethers } from "ethers";
import VAULT_ABI from "@/web3/abis/balancer/vault.json";
import axios from "axios";

async function getTokenPrices() {
  try {
    const response = await axios.get("/api/market-rate");
    if (response.status === 200 || response.status === 201) {
      const prices = response.data;

      return {
        "0x27f485b62c4a7e635f561a87560adf5090239e93": prices.DFX.USD,
        "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": prices.USDC.USD,
        "0xdf7837de1f2fa4631d716cf2502f8b230f1dcc32": prices.TEL.USD,
        "0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3": prices.BAL.USD,
        "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": prices.WETH.USD,
        "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": prices.WPOL.USD,
        "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6": prices.WBTC.USD,
        "0xd6df932a45c0f255f85145f286ea0b292b21c90b": prices.AAVE.USD,
        "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": prices["USDC.e"].USD,
        "0xe7804d91dfcde7f776c90043e03eaa6df87e6395": 0,
      };
    } else {
      throw new Error("Failed to fetch token prices");
    }
  } catch (error) {
    console.error("Error fetching token prices:", error);
    throw error;
  }
}

export const getPoolLiquidityValue = async (
  poolId: string,
  tokenDecimals: Record<string, number>
) => {
  const vaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const vaultContract = new Contract(vaultAddress, VAULT_ABI, provider);
  // Get pool tokens and balances
  const { tokens, balances } = await vaultContract.getPoolTokens(poolId);
  const normalizedTokens = tokens.map((token: string) => token.toLowerCase());

  const tokenPrices: Record<string, number> = await getTokenPrices();

  let totalLiquidityUSD = 0;

  normalizedTokens.forEach((token: number, index: number) => {
    const decimals = tokenDecimals[token];
    const balance = parseFloat(ethers.formatUnits(balances[index], decimals));
    const valueUSD = balance * tokenPrices[token];
    totalLiquidityUSD += valueUSD;
  });

  return totalLiquidityUSD;
};
