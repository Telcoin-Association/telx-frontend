import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType } from "../all/createStakingContract";
import { quickswapGetStakeInfo } from "./getStakeInfo";
import { Decimals } from "../uniswapv4/getSingleContractData";
import { Position } from "@/app/api/uniswap-user-positions-polygon/route";

export interface QuickswapSubgraphInfo {
  pool: {
    reserveUSD: number;
  };
  poolSnapshots: Array<{
    date: number;
    dailyVolumeUSD: number;
  }>;
  quarterYearLiquidityData: Array<{
    date: number;
    reserveUSD: number;
  }>;
}

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

export type QuickswapContractData = {
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
  dailyVolumeUSD: number;
  fees24hr?: number | null;
  illustration: string;
  user: UserInfo;
  stakingPeriod: string;
  vestingPeriod: string;
  vestingPeriodHelpText: string | undefined;
  totalStaked: number | null;
  totalSupply: number | null;
  subgraphId: string;
  liquidityChartData: any;
  volumeChartData: any;
  decimals?: Decimals;
  positions?: Position[];
};

export async function quickswapGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined,
  subgraphInfoForQuickswapPool: any | undefined
): Promise<QuickswapContractData> {
  const poolAddress = value.pool;
  const type = value.rewards.type as ContractType;

  let subgraphInfo = {} as any;

  subgraphInfo = subgraphInfoForQuickswapPool;

  let totalLiquidity;
  let dailyVolumeUSD;
  let fees24hr;

  let liquidityChartData = [] as any;
  let volumeChartData = [] as any;

  if (subgraphInfo) {
    totalLiquidity = subgraphInfo.pool
      ? subgraphInfo.pool.reserveUSD
      : undefined;
    if (subgraphInfo?.poolSnapshots?.length > 0) {
      dailyVolumeUSD = subgraphInfo.poolSnapshots[0].dailyVolumeUSD;
      fees24hr = dailyVolumeUSD != 0 ? dailyVolumeUSD * 0.003 : undefined;
    }
    if (subgraphInfo?.quarterYearLiquidityData?.length > 0) {
      liquidityChartData = subgraphInfo.quarterYearLiquidityData;
      volumeChartData = subgraphInfo.quarterYearLiquidityData;
    }
  }

  let stakeAddress = value.activeStakingAddress?.address;
  const deprecatedContractPresent =
    value.deprecatedStakingAddresses?.length > 0;

  let stakeInfo: any;

  if (stakeAddress) {
    stakeInfo = await quickswapGetStakeInfo(
      stakeAddress,
      poolAddress,
      type,
      totalLiquidity || 0,
      value,
      selectedWalletAddress
    );
  } else {
    // if no active staking address, use the latest deprecated address
    stakeAddress =
      value.deprecatedStakingAddresses?.[
        value.deprecatedStakingAddresses.length - 1
      ].address;
  }

  let stakeInfoDeprecated;
  let stakeAddressDeprecated: any = "";
  if (deprecatedContractPresent) {
    stakeAddressDeprecated =
      value.deprecatedStakingAddresses?.[
        value.deprecatedStakingAddresses.length - 1
      ].address;
    stakeInfoDeprecated = await quickswapGetStakeInfo(
      stakeAddressDeprecated,
      poolAddress,
      type,
      totalLiquidity || 0,
      value,
      selectedWalletAddress
    );
  }

  const contractData: QuickswapContractData = {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    deprecated: value.deprecated,
    deprecatedStakingAddresses: value.deprecatedStakingAddresses,
    poolContractAddress: poolAddress,
    stakeContractAddress: stakeAddress,
    stakeAddressDeprecated: stakeAddressDeprecated,
    deprecatedContractPresent: deprecatedContractPresent,
    assets: value.assets,
    rewards: stakeInfo.rewards,
    rewardsInterval: value.rewards.rewardsInterval,
    protocol: "quickswap",
    blockchain: "polygon",
    totalLiquidity: totalLiquidity || 0,
    stakedLiquidity: stakeInfo.stakedLiquidity || 0,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics,
    userStaked: true,
    selectedWalletAddress: selectedWalletAddress,
    dailyVolumeUSD: dailyVolumeUSD ?? 0,
    fees24hr: fees24hr,
    illustration: value.illustration,
    user: {
      balanceLPT: Number(stakeInfo.balanceLPT), // Explicit conversion to Number
      stakedLPT: Number(stakeInfo.stakedLPT), // Explicit conversion to Number
      stakedUSD: stakeInfo.stakedUSD,
      deprecated: stakeInfoDeprecated
        ? {
          balanceLPT: Number(stakeInfoDeprecated.balanceLPT), // Conversion
          stakedLPT: Number(stakeInfoDeprecated.stakedLPT), // Conversion
          stakedUSD: stakeInfoDeprecated.stakedUSD,
          rewards: stakeInfoDeprecated.rewards,
        }
        : null,
    },
    stakingPeriod: value.stakingPeriod || "",
    vestingPeriod: '', // added for type support
    vestingPeriodHelpText: undefined, // added for type support
    totalStaked: stakeInfo?.totalStaked || null,
    totalSupply: stakeInfo?.totalSupply || null,
    subgraphId: value.subgraphId || '',
    liquidityChartData: liquidityChartData,
    volumeChartData: volumeChartData,
  };
  return contractData;
}
