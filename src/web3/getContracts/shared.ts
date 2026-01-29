import { dfxGetSingleContractData, DfxContractData } from "./dfx/getSingleContractData";
import { quickswapGetSingleContractData, QuickswapContractData } from "./quickswap/getSingleContractData";
import { balancerGetSingleContractData, BalancerContractData } from "./balancer/getSingleContractData";
import { UniswapContractData, uniswapGetSingleContractData } from "./uniswapv4/getSingleContractData";
import { miningContract } from "../../helpers/normalizeMiningContracts";
import { getTokenPricesCached } from "@/helpers/getTokenPricesCached";
import { prefetchGroupedSubgraph } from "@/helpers/prefetchGroupedSubgraph";

export type ProtocolsContractData = BalancerContractData | DfxContractData | QuickswapContractData | UniswapContractData;

export async function getAllContractData(CONTRACTS_DATA: miningContract[], selectedWalletAddress: string | undefined) {
  const contracts: ReturnType<typeof quickswapGetSingleContractData | typeof balancerGetSingleContractData | typeof dfxGetSingleContractData | typeof uniswapGetSingleContractData>[] = [];
  const hasBalancer = CONTRACTS_DATA.some(c => c.protocol === "balancer");
  const tokenPrices = hasBalancer ? await getTokenPricesCached() : undefined;

  const { quickswapById, uniswapById, balancerById } = await prefetchGroupedSubgraph(CONTRACTS_DATA);

  console.log(uniswapById, "uniswapById")

  for (let i = 0; i < CONTRACTS_DATA.length; i++) {
    const value = CONTRACTS_DATA[i];
    const poolId = CONTRACTS_DATA[i].pool;
    const poolKey = value.pool?.trim().toLowerCase();

    switch (value.protocol) {
      case "quickswap":
        contracts.push(quickswapGetSingleContractData(value, selectedWalletAddress, quickswapById[poolKey]));
        break;

      case "balancer":
        contracts.push(balancerGetSingleContractData(value, selectedWalletAddress, tokenPrices!, value.subgraphId && balancerById[value.subgraphId]));
        break;

      case "dfx":
        contracts.push(dfxGetSingleContractData(value, selectedWalletAddress));
        break;
      case "uniswap":
        contracts.push(uniswapGetSingleContractData(value, selectedWalletAddress, uniswapById[poolId]));
        break;
    }
  }
  return await Promise.all(contracts);
}