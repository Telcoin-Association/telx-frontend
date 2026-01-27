import { getStakeInfo } from "./getStakeInfo";
import {
  balancerGetSubgraphData,
  BalancerSubgraphInfo,
} from "./getSubgraphInfo";
import { getRewardsValuesNoStakingContract } from "./getRewardsValues";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ApolloQueryResult } from "@apollo/client";
import { ContractType } from "../all/createStakingContract";
import { getPoolLiquidityValue } from "@/web3/getContracts/balancer/vault";
import { Decimals } from "../uniswapv4/getSingleContractData";
import { Position } from "@/app/api/uniswap-user-positions-polygon/route";

type UserInfo = {
  balanceLPT?: number | string;
  stakedLPT?: number | string;
  stakedUSD?: number;
  deprecated?: {
    balanceLPT: number | string;
    stakedLPT: number | string;
    stakedUSD: number;
    rewards?: any;
  } | null;
};

export type BalancerContractData = {
  activeStakingAddress:
  | {
    address: string;
    start_date: string;
    end_date: string | null;
    active: boolean;
    pool: string;
  }
  | undefined;
  name: string;
  deprecated: boolean;
  deprecatedStakingAddresses: any[];
  poolContractAddress: string;
  stakeContractAddress: string | undefined;
  stakeAddressDeprecated: string;
  deprecatedContractPresent: boolean;
  assets: any[];
  rewards: any;
  rewardsInterval: string | null;
  protocol: string;
  blockchain: string;
  totalLiquidity: number | undefined;
  stakedLiquidity: number | null;
  addLiquidityLink: string;
  poolAnalyticsLink: string | null;
  userStaked: boolean;
  selectedWalletAddress: string | undefined;
  illustration: string;
  dailyVolumeUSD: number;
  user: UserInfo;
  stakingPeriod: any;
  subgraphId: string;
  vestingPeriod: any;
  vestingPeriodHelpText: string;
  fees24hr?: number | null;
  totalStaked: number | null;
  totalSupply: number | null;
  liquidityChartData: any;
  volumeChartData: any;
  feeChartData: any;
  decimals?: Decimals;
  positions?: Position[];
};

export async function balancerGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined,
  tokenPrices: Record<string, number>,
  subgraphInfoForBalancerPool: any | undefined

): Promise<BalancerContractData> {
  const poolAddress = value.pool;
  const type = value.rewards.type as ContractType;

  // subgraph data for total liquidity
  const subgraphId = value.subgraphId;

  let subgraphInfo = {} as any;
  // let subgraphInfo = {} as ApolloQueryResult<BalancerSubgraphInfo>;

  // if (subgraphId) {
  //   try {
  //     const response = await fetch(
  //       `/api/backend/subgraphs/balancer?subgraphId=${subgraphId}`
  //     );
  //     if (response.ok) {
  //       const { redisData } = await response.json();
  //       subgraphInfo = redisData.data;
  //       console.log(redisData.data, 'redisData.data')
  //       console.log(subgraphInfoForBalancerPool, 'subgraphInfoForBalancerPool')
  //     } else {
  //       throw new Error(
  //         `Error fetching balancer subgraph data from backend. subgraph ID:${subgraphId}`
  //       );
  //     }
  //   } catch (e) {
  //     console.error(
  //       "Error fetching from balancer data from backend, falling back to subgraph",
  //       e
  //     );
  //     try {
  //       subgraphInfo = await balancerGetSubgraphData(subgraphId);
  //     } catch (subgraphError) {
  //       console.error("Fallback to balancer subgraph failed", subgraphError);
  //     }
  //   }
  // }

  console.log(subgraphInfoForBalancerPool, "subgraphInfoForBalancerPool === >")
  subgraphInfo = subgraphInfoForBalancerPool && subgraphInfoForBalancerPool;

  let totalLiquidity: number = 0;
  let dailyVolumeUSD;
  let fees24hr;

  let liquidityChartData = [] as any;
  let volumeChartData = [] as any;

  if (subgraphInfo) {
    const tokenDecimals = {
      "0x27f485b62c4a7e635f561a87560adf5090239e93": 18, // DFX
      "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 6, // USDC
      "0xdf7837de1f2fa4631d716cf2502f8b230f1dcc32": 2, // TEL
      "0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3": 18, // BAL
      "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": 18, // WETH
      "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": 18, // WPOL
      "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6": 8, // WBTC
      "0xd6df932a45c0f255f85145f286ea0b292b21c90b": 18, // AAVE
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": 6, // USDC.e
      "0xe7804d91dfcde7f776c90043e03eaa6df87e6395": 18, // DFX Finance (old)
    };

    totalLiquidity = await getPoolLiquidityValue(
      `${subgraphId}`,
      tokenDecimals,
      tokenPrices
    );

    if (subgraphInfo?.poolSnapshots?.length > 0) {
      if (subgraphInfo.poolSnapshots.length === 1) {
        dailyVolumeUSD = subgraphInfo.poolSnapshots[0].swapVolume;
        fees24hr = subgraphInfo.poolSnapshots[0].swapFees;
      } else {
        dailyVolumeUSD =
          subgraphInfo.poolSnapshots[1].swapVolume -
          subgraphInfo.poolSnapshots[0].swapVolume;
        fees24hr =
          subgraphInfo.poolSnapshots[1].swapFees -
          subgraphInfo.poolSnapshots[0].swapFees;
      }
    }
  }
  if (subgraphInfo?.quarterYearLiquidityData?.length > 0) {
    liquidityChartData = subgraphInfo.quarterYearLiquidityData;
  }
  if (subgraphInfo?.quarterYearVolumeData?.length > 0) {
    const sortedVolumeData = [...subgraphInfo.quarterYearVolumeData].sort(
      (a, b) => a.date - b.date
    );
    const modifiedVolumeData = sortedVolumeData.map((data, index) => {
      if (index === 0) return data;
      return {
        ...data,
        swapVolume: data.swapVolume - sortedVolumeData[index - 1].swapVolume,
        swapFees: data.swapFees - sortedVolumeData[index - 1].swapFees,
      };
    });
    volumeChartData = modifiedVolumeData;
  }

  let stakeAddress = value.activeStakingAddress?.address;
  const deprecatedContractPresent =
    value.deprecatedStakingAddresses?.length > 0;
  let stakeInfo;
  if (stakeAddress) {
    stakeInfo = await getStakeInfo(
      stakeAddress,
      poolAddress,
      type,
      totalLiquidity,
      value,
      selectedWalletAddress
    );
  } else {
    // if no active staking address, use the latest deprecated address
    stakeAddress = value.deprecatedStakingAddresses?.[0].address;
  }

  let stakeInfoDeprecated;
  let stakeAddressDeprecated = "";
  if (deprecatedContractPresent) {
    stakeAddressDeprecated =
      value.deprecatedStakingAddresses?.[
        value.deprecatedStakingAddresses.length - 1
      ].address;
    stakeInfoDeprecated = await getStakeInfo(
      stakeAddressDeprecated,
      poolAddress,
      type,
      totalLiquidity,
      value,
      selectedWalletAddress
    );
  }

  const contractData: any = {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    deprecated: value.deprecated,
    deprecatedStakingAddresses: value.deprecatedStakingAddresses,
    poolContractAddress: poolAddress,
    stakeContractAddress: stakeAddress,
    stakeAddressDeprecated: stakeAddressDeprecated,
    deprecatedContractPresent: deprecatedContractPresent,
    assets: value.assets,
    rewards: stakeInfo
      ? stakeInfo.rewards
      : await getRewardsValuesNoStakingContract({ rewardsInfo: value.rewards }),
    rewardsInterval: value.rewards.rewardsInterval,
    protocol: "balancer",
    blockchain: "polygon",
    totalLiquidity: totalLiquidity,
    stakedLiquidity: stakeInfo ? stakeInfo.stakedLiquidity : null,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics,
    userStaked: true,
    selectedWalletAddress: selectedWalletAddress,
    illustration: value.illustration,
    dailyVolumeUSD: dailyVolumeUSD,
    user: {
      balanceLPT: stakeInfo ? stakeInfo.balanceLPT : 0,
      stakedLPT: stakeInfo ? stakeInfo.stakedLPT : 0,
      stakedUSD: stakeInfo ? stakeInfo.stakedUSD : 0,
      deprecated: stakeInfoDeprecated
        ? {
          balanceLPT: stakeInfoDeprecated.balanceLPT,
          stakedLPT: stakeInfoDeprecated.stakedLPT,
          stakedUSD: stakeInfoDeprecated.stakedUSD,
          rewards: stakeInfoDeprecated.rewards,
        }
        : null,
    },
    stakingPeriod: value.stakingPeriod,
    subgraphId: value.subgraphId,
    vestingPeriod: value.vestingPeriod,
    vestingPeriodHelpText: value.vestingPeriodHelpText,
    fees24hr, // added for type support
    totalStaked: stakeInfo?.totalStaked || null,
    totalSupply: stakeInfo?.totalSupply || null,
    liquidityChartData: liquidityChartData,
    volumeChartData: volumeChartData,
    feeChartData: [],
  };

  return contractData;
}
