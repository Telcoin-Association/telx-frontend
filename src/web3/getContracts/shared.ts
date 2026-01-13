import { dfxGetSingleContractData } from "./dfx/getSingleContractData";
import { quickswapGetSingleContractData } from "./quickswap/getSingleContractData";
import { balancerGetSingleContractData } from "./balancer/getSingleContractData";
import { miningContract } from "../../helpers/normalizeMiningContracts";
import { ZERO_TOKEN_BALANCE } from "@/lib/constants";

//types
import { BalancerContractData } from "./balancer/getSingleContractData";
import { DfxContractData } from "./dfx/getSingleContractData";
import { QuickswapContractData } from "./quickswap/getSingleContractData";
import { UniswapContractData, uniswapGetSingleContractData } from "./uniswapv4/getSingleContractData";

export type ProtocolsContractData = BalancerContractData | DfxContractData | QuickswapContractData | UniswapContractData ;

export async function getSingleContractDataByPoolAddress(
  poolAddress: string,
  selectedWalletAddress: string,
  miningContracts: miningContract[],
) {
  const contract: any = miningContracts.find((c: any) => c.pool === poolAddress);

  if (contract) {
    switch (contract?.protocol) {
      case "dfx":
        return dfxGetSingleContractData(contract, selectedWalletAddress);

      case "balancer":
        return balancerGetSingleContractData(contract, selectedWalletAddress);

      case "quickswap":
        return quickswapGetSingleContractData(contract, selectedWalletAddress);

      case "uniswap":
          return uniswapGetSingleContractData(contract, selectedWalletAddress);
    }
  }
}

// This bit of Typescript let's us infer the type from the value returned by
// the async (Promise) function `getSingleContractDataByPoolAddress`
type AsyncReturnType<T extends (...args: any) => Promise<any>> = T extends (...args: any) => Promise<infer R> ? R : any;
export type SingleContract = AsyncReturnType<typeof getSingleContractDataByPoolAddress>;

export async function getAllContractData(CONTRACTS_DATA: miningContract[], selectedWalletAddress: string | undefined) {
  const contracts: ReturnType<typeof quickswapGetSingleContractData | typeof balancerGetSingleContractData | typeof dfxGetSingleContractData | typeof uniswapGetSingleContractData>[] = [];

  // iterate through all QUICKSWAP_CONTRACT_ADDRESSES and return JSON for that contract
  for (let i = 0; i < CONTRACTS_DATA.length; i++) {
    const value = CONTRACTS_DATA[i];
    switch (value.protocol) {
      case "quickswap":
        contracts.push(quickswapGetSingleContractData(value, selectedWalletAddress));
        break;

      case "balancer":
        contracts.push(balancerGetSingleContractData(value, selectedWalletAddress));
        break;

      case "dfx":
        contracts.push(dfxGetSingleContractData(value, selectedWalletAddress));
        break;
      case "uniswap":
        contracts.push(uniswapGetSingleContractData(value, selectedWalletAddress));
       
        break;
    }
  }
  return await Promise.all(contracts);
}

export async function getRewardsContractData(CONTRACTS_DATA: miningContract[], selectedWalletAddress: string) {
  const contracts: ReturnType<typeof quickswapGetSingleContractData | typeof balancerGetSingleContractData | typeof dfxGetSingleContractData>[] = [];

  // iterate through all QUICKSWAP_CONTRACT_ADDRESSES and return JSON for those that the user has liquidity staked in
  for (let i = 0; i < CONTRACTS_DATA.length; i++) {
    const value = CONTRACTS_DATA[i];
    switch (value.protocol) {
      case "quickswap":
        contracts.push(quickswapGetSingleContractData(value, selectedWalletAddress));
        break;

      case "balancer":
        contracts.push(balancerGetSingleContractData(value, selectedWalletAddress));
        break;

      case "dfx":
        contracts.push(dfxGetSingleContractData(value, selectedWalletAddress));
        break;
    }
  }

  const contractsData = await Promise.all(contracts);

  const stakedRewards = contractsData.filter(contract => {
    if (contract?.user?.stakedLPT !== undefined) {
      return Number(contract.user.stakedLPT) > 0 && contract.user.stakedLPT !== ZERO_TOKEN_BALANCE;
    }
    return false;
  });
  const stakedRewardsDeprecated = contractsData.filter(contract => {
    if (contract?.user?.deprecated?.stakedLPT !== undefined) {
      return Number(contract.user.deprecated.stakedLPT) > 0 && contract.user.deprecated.stakedLPT !== ZERO_TOKEN_BALANCE;
    }
    return false;
  });
  return stakedRewards.concat(stakedRewardsDeprecated);
}
