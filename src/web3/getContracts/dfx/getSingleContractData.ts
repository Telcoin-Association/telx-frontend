import { dfxGetStakeInfo } from "./getStakeInfo";
import { dfxGetSubgraphInfo, DfxSubgraphInfo } from "./getSubgraphInfo";
import { getTimestampForStartOfDay } from "../../../helpers/getTimestamp";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ApolloQueryResult } from "@apollo/client";
import { ContractType } from "../all/createStakingContract";
import { ProtocolsContractData } from "../shared";
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

export type DfxContractData = {
  activeStakingAddress?: any;
  name: string;
  active?: boolean;
  deprecated?: boolean;
  deprecatedStakingAddresses?: any[];
  poolContractAddress: string;
  stakeContractAddress?: string;
  stakeAddressDeprecated?: string;
  assets: any;
  rewards?: any;
  rewardsInterval?: any;
  protocol: string;
  blockchain: string;
  totalLiquidity?: number | undefined;
  stakedLiquidity?: number | null;
  addLiquidityLink?: string;
  poolAnalyticsLink?: string | null;
  userStaked: boolean;
  selectedWalletAddress: string | undefined;
  dailyVolumeUSD: number;
  illustration?: string;
  subgraphId?: string;
  pairIdTimestamp: number;
  user: UserInfo;
  stakingPeriod?: any;
  deprecatedContractPresent?: boolean;
  fees24hr?: number | null;
  vestingPeriod?: any;
  vestingPeriodHelpText?: string;
  totalStaked?: number;
  totalSupply?: number;
  liquidityChartData: any;
  volumeChartData: any;
  decimals?: Decimals;
  positions?: Position[];
};

export async function dfxGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined
): Promise<DfxContractData> {
  const poolAddress = value.pool;
  const subgraphId = value.subgraphId;
  const type = value?.rewards.type as ContractType;

  let subgraphInfo = {} as ApolloQueryResult<DfxSubgraphInfo>;
  if (value.fetchSubgraph) {
    try {
      const response = await fetch(
        `/api/backend/subgraphs/dfx?poolAddress=${poolAddress}`
      );
      if (response.ok) {
        const { redisData } = await response.json();
        subgraphInfo = redisData.data;
      } else {
        throw new Error(
          `Error fetching DFX subgraph data from backend. pool address:${poolAddress}`
        );
      }
    } catch (e) {
      console.error(
        "Error fetching from DFX data from backend, falling back to subgraph",
        e
      );
      try {
        subgraphInfo = await dfxGetSubgraphInfo(poolAddress);
      } catch (subgraphError) {
        console.error("Fallback to DFX subgraph failed", subgraphError);
      }
    }
  }


  let totalLiquidity: number | undefined;
  let dailyVolumeUSD;
  let liquidityChartData = [] as any;
  let volumeChartData = [] as any;
  if (subgraphInfo.data) {
    totalLiquidity = subgraphInfo.data.pair
      ? subgraphInfo.data.pair.reserveUSD
      : undefined;
    dailyVolumeUSD = subgraphInfo.data.pairDayData
      ? subgraphInfo.data.pairDayData.volumeUSD
      : undefined;
  }
  if (subgraphInfo.data?.quarterYearLiquidityData?.length > 0) {
    liquidityChartData = subgraphInfo.data.quarterYearLiquidityData;
  }
  if (subgraphInfo.data?.quarterYearVolumeData?.length > 0) {
    volumeChartData = subgraphInfo.data.quarterYearVolumeData;
  }
  let stakeAddress = value.activeStakingAddress?.address;
  let stakeInfo;
  if (stakeAddress) {
    stakeInfo = await dfxGetStakeInfo(
      stakeAddress,
      poolAddress,
      type,
      totalLiquidity ?? 0,
      value,
      selectedWalletAddress
    );
  } else {
    // if no active staking address, use the latest deprecated address
    stakeAddress = value.deprecatedStakingAddresses?.[0].address;
  }

  const deprecatedContractPresent =
    value.deprecatedStakingAddresses?.length > 0;
  let stakeInfoDeprecated;
  let stakeAddressDeprecated = "";
  if (deprecatedContractPresent) {
    stakeAddressDeprecated =
      value.deprecatedStakingAddresses?.[
        value.deprecatedStakingAddresses.length - 1
      ].address;
    stakeInfoDeprecated = await dfxGetStakeInfo(
      stakeAddressDeprecated,
      poolAddress,
      type,
      totalLiquidity ?? 0,
      value,
      selectedWalletAddress
    );
  }

  const getPairIdTimestamp = () => {
    const timestamp = getTimestampForStartOfDay();
    return Math.trunc(timestamp / 86400);
  };
  const pairIdTimestamp = getPairIdTimestamp();

  const contractData: ProtocolsContractData = {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    active: value.active,
    deprecated: value.deprecated,
    deprecatedStakingAddresses: value.deprecatedStakingAddresses,
    poolContractAddress: poolAddress,
    stakeContractAddress: stakeAddress,
    stakeAddressDeprecated: stakeAddressDeprecated,
    assets: value.assets,
    rewards: stakeInfo?.rewards,
    rewardsInterval: value?.rewards.rewardsInterval,
    protocol: "dfx",
    blockchain: "polygon",
    totalLiquidity: stakeInfo?.stakedLiquidity || 0,
    stakedLiquidity: stakeInfo?.stakedLiquidity,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics || undefined,
    userStaked: true,
    selectedWalletAddress: selectedWalletAddress,
    dailyVolumeUSD: dailyVolumeUSD || 0,
    illustration: value.illustration,
    subgraphId: subgraphId || '',
    pairIdTimestamp: pairIdTimestamp,
    user: {
      balanceLPT: stakeInfo?.balanceLPT, // how many pool tokens do they have (unit: LP tokens)
      stakedLPT: stakeInfo?.stakedLPT, // how many pool tokens have they staked in TELx (unit: LP tokens)
      stakedUSD: stakeInfo?.stakedUSD, // $ value of how much they have staked (unit: USD)
      deprecated: stakeInfoDeprecated
        ? {
          balanceLPT: stakeInfoDeprecated.balanceLPT,
          stakedLPT: stakeInfoDeprecated.stakedLPT,
          stakedUSD: stakeInfoDeprecated.stakedUSD,
          rewards: stakeInfoDeprecated?.rewards,
        }
        : undefined,
    },
    stakingPeriod: value.stakingPeriod,
    deprecatedContractPresent: undefined, // added for type support
    fees24hr: undefined, // added for type support
    vestingPeriod: undefined, // added for type support
    vestingPeriodHelpText: undefined, // added for type support
    totalStaked: stakeInfo?.totalStaked || 0,
    totalSupply: stakeInfo?.totalSupply || 0,
    liquidityChartData: liquidityChartData,
    volumeChartData: volumeChartData,
  };
  return contractData;
}
