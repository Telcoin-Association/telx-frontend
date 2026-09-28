import { getTokenDataById } from "@/helpers/getRewardsById";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
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

export type Decimals = {
  amount0Decimals?: number
  amount1Decimals?: number
}

export type UniswapContractData = {
  activeStakingAddress: miningContract["activeStakingAddress"] | undefined;
  name: string;
  active: boolean;
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
  protocolVersion?: string;
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
  feeChartData: any;
  decimals?: Decimals;
  positions?: Position[];
};

export async function uniswapGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined,
  subgraphInfoForPool: any | undefined
): Promise<UniswapContractData> {
  const poolAddress = value.pool;

  const rewards = getTokenDataById(poolAddress)

  let subgraphInfo = {} as any;

  subgraphInfo = subgraphInfoForPool

  let totalLiquidity;
  let dailyVolumeUSD: number | undefined = 0;
  let fees24hr: number | undefined = 0;

  let liquidityChartData: any[] = [];
  let volumeChartData: any[] = [];
  let feeChartData: any[] = [];

  if (subgraphInfo) {
    const pool = subgraphInfo.pool;
    totalLiquidity = pool?.totalValueLockedUSD;

    const snapshots = subgraphInfo.poolSnapshots ?? [];

    // ✅ Get current timestamp and 24h ago
    const now = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgo = now - 86400;

    // ✅ Filter only snapshots from the last 24 hours
    const filteredSnapshots = snapshots.filter((s: any) => Number(s.periodStartUnix) >= twentyFourHoursAgo);

    // ✅ Sum up volume and fees from those filtered snapshots
    for (const snapshot of filteredSnapshots) {
      dailyVolumeUSD += Number(snapshot.volumeUSD);
      fees24hr += Number(snapshot.feesUSD);
    }

    // ✅ Optional fallback if values are still zero (due to indexing lag or empty data)
    if (!dailyVolumeUSD) dailyVolumeUSD = undefined;
    if (!fees24hr) fees24hr = undefined;

    if (subgraphInfo.weeklyVolume) {
      volumeChartData = subgraphInfo.weeklyVolume;
      feeChartData = subgraphInfo.weeklyVolume;
    }

    if (subgraphInfo?.threeMonthLiquidityData?.length > 0) {
      const sortedVolumeData = [...subgraphInfo.threeMonthLiquidityData].sort((a, b) => a.date - b.date);
      liquidityChartData = subgraphInfo.threeMonthLiquidityData;
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
  }

  const deprecatedContractPresent = value.deprecatedStakingAddresses?.length > 0;
  let stakeInfo: any;

  let stakeAddressDeprecated = "";
  if (deprecatedContractPresent) {
    stakeAddressDeprecated = value.deprecatedStakingAddresses![value.deprecatedStakingAddresses.length - 1].address;
  }

  const temp = {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    active: value.active,
    deprecated: value.deprecated,
    deprecatedStakingAddresses: value.deprecatedStakingAddresses,
    poolContractAddress: poolAddress,
    stakeContractAddress: '',
    stakeAddressDeprecated,
    deprecatedContractPresent,
    assets: value.assets,
    rewards: rewards,
    rewardsInterval: value.rewards.rewardsInterval,
    protocol: value?.protocol || "uniswap",
    protocolVersion: value?.protocolVersion || "",
    blockchain: value?.blockchain || "polygon",
    totalLiquidity: totalLiquidity || 0,
    stakedLiquidity: stakeInfo?.stakedLiquidity || 0,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics,
    userStaked: true,
    selectedWalletAddress,
    dailyVolumeUSD: dailyVolumeUSD ?? 0,
    fees24hr,
    illustration: value.illustration,
    user: {
      balanceLPT: Number(stakeInfo?.balanceLPT),
      stakedLPT: Number(stakeInfo?.stakedLPT),
      stakedUSD: stakeInfo?.stakedUSD,
      deprecated: null,
    },
    stakingPeriod: value.stakingPeriod || "",
    vestingPeriod: "",
    vestingPeriodHelpText: undefined,
    totalStaked: stakeInfo?.totalStaked || null,
    totalSupply: stakeInfo?.totalSupply || null,
    subgraphId: value.subgraphId || "",
    liquidityChartData,
    volumeChartData,
    feeChartData,
    decimals: value.decimals
  };

  return temp;
}
