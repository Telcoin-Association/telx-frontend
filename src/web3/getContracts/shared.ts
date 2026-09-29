import { dfxGetSingleContractData, DfxContractData } from "./dfx/getSingleContractData";
import { quickswapGetSingleContractData, QuickswapContractData } from "./quickswap/getSingleContractData";
import { balancerGetSingleContractData, BalancerContractData } from "./balancer/getSingleContractData";
import { UniswapContractData, uniswapGetSingleContractData } from "./uniswapv4/getSingleContractData";
import { miningContract } from "../../helpers/normalizeMiningContracts";
import { getTokenPricesCached } from "@/helpers/getTokenPricesCached";
import { prefetchPoolData } from "@/helpers/prefetchPoolData";
import { DataFreshness } from "@/types/PoolMetrics";

export type ProtocolsContractData = BalancerContractData | DfxContractData | QuickswapContractData | UniswapContractData;

export async function getAllContractData(
  CONTRACTS_DATA: miningContract[],
  selectedWalletAddress: string | undefined
): Promise<{ contracts: ProtocolsContractData[]; meta: DataFreshness }> {
  const contracts: ReturnType<typeof quickswapGetSingleContractData | typeof balancerGetSingleContractData | typeof dfxGetSingleContractData | typeof uniswapGetSingleContractData>[] = [];
  const { uniswapById, meta } = await prefetchPoolData(CONTRACTS_DATA);

  for (let i = 0; i < CONTRACTS_DATA.length; i++) {
    const value = CONTRACTS_DATA[i];
    const poolKey = value.pool?.trim().toLowerCase();

    switch (value.protocol) {
      case "quickswap":
        contracts.push(quickswapGetSingleContractData(value, selectedWalletAddress));
        break;

      case "balancer":
        contracts.push(balancerGetSingleContractData(value, selectedWalletAddress, getTokenPricesCached));
        break;

      case "dfx":
        contracts.push(dfxGetSingleContractData(value, selectedWalletAddress));
        break;
      case "uniswap":
        contracts.push(
          uniswapGetSingleContractData(
            value,
            selectedWalletAddress,
            uniswapById?.[`${value.blockchain}:${poolKey}`] || uniswapById?.[poolKey]
          )
        );
        break;
    }
  }
  return { contracts: await Promise.all(contracts), meta };
}
