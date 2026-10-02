import { getTokenDataById } from "@/helpers/getRewardsById";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import type { Position } from "@/lib/positions";
import { GroupedPool } from "@/helpers/fetchPoolData";
import { activityFields, numberOrNull, PoolActivityFields } from "@/helpers/poolMetrics";
import type { RewardsStatus } from "@/types/PoolRewards";

type UserInfo = {
  /** True when a wallet read failed, so the figures below are unknown rather than 0. */
  readFailed?: boolean;
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

export type UniswapContractData = PoolActivityFields & {
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
  totalLiquidity: number | null;
  stakedLiquidity: number | null;
  addLiquidityLink: string;
  poolAnalyticsLink: string | null;
  userStaked: boolean;
  selectedWalletAddress: string | undefined;
  dailyVolumeUSD: number | null;
  fees24hr: number | null;
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
  // Merkl rewards (null when unknown or no campaign matched). `rewards` above is the reward token config.
  // `rewardsKnown` tells the two apart: false when the server could not read the rewards or sent no data.
  rewardsKnown: boolean;
  rewardsStatus: RewardsStatus | null;
  rewardsApr: number | null; // percent, live campaigns only
  rewardsDailyRewards: number | null; // USD per day, live campaigns only
  subscribedTvlUSD: number | null; // liquidity subscribed for rewards, live campaigns only
  rewardsCampaignStart: number | null; // unix ms
  rewardsCampaignEnd: number | null; // unix ms
  rewardsPending: boolean; // live, but Merkl has not measured it yet: its APR and SVL are null
};

export async function uniswapGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined,
  poolData: GroupedPool | undefined
): Promise<UniswapContractData> {
  const poolAddress = value.pool;

  const rewards = getTokenDataById(poolAddress)

  const served = poolData as any;
  const metrics = poolData?.metrics;
  const merkl = poolData?.rewards ?? null;
  const rewardsKnown = poolData?.rewards !== undefined;

  let totalLiquidity: number | null = null;
  let dailyVolumeUSD: number | null = null;
  let fees24hr: number | null = null;

  let liquidityChartData: any[] = [];
  let volumeChartData: any[] = [];
  let feeChartData: any[] = [];

  if (metrics) {
    totalLiquidity = metrics.tvlUSD;
    dailyVolumeUSD = metrics.volume24h;
    fees24hr = metrics.fees24h;
  } else if (metrics === null) {
    // Metrics withheld by the server: volume and fees are unknown, not zero.
    totalLiquidity = numberOrNull(served?.pool?.totalValueLockedUSD);
  } else if (served) {
    // Legacy payload without metrics: sum the hourly rows of the trailing 24h.
    totalLiquidity = numberOrNull(served.pool?.totalValueLockedUSD);

    const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - 86400;
    const rows = (served.poolSnapshots ?? []).filter((s: any) => Number(s.periodStartUnix) >= twentyFourHoursAgo);

    dailyVolumeUSD = rows.reduce((sum: number, s: any) => sum + (Number(s.volumeUSD) || 0), 0);
    fees24hr = rows.reduce((sum: number, s: any) => sum + (Number(s.feesUSD) || 0), 0);
  }

  if (served) {
    if (served.weeklyVolume) {
      volumeChartData = served.weeklyVolume;
      feeChartData = served.weeklyVolume;
    }

    if (served?.threeMonthLiquidityData?.length > 0) {
      const sortedVolumeData = [...served.threeMonthLiquidityData].sort((a, b) => a.date - b.date);
      liquidityChartData = served.threeMonthLiquidityData;
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
    totalLiquidity,
    // Uniswap v4 pools have no staking contract to read. Liquidity earning rewards is subscribedTvlUSD below.
    stakedLiquidity: null,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics,
    userStaked: true,
    selectedWalletAddress,
    dailyVolumeUSD,
    fees24hr,
    ...activityFields(metrics),
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
    decimals: value.decimals,
    rewardsKnown,
    rewardsStatus: merkl?.status ?? null,
    rewardsApr: merkl?.apr ?? null,
    rewardsDailyRewards: merkl?.dailyRewards ?? null,
    subscribedTvlUSD: merkl?.subscribedTvlUSD ?? null,
    rewardsCampaignStart: merkl?.campaignStart ?? null,
    rewardsCampaignEnd: merkl?.campaignEnd ?? null,
    rewardsPending: merkl?.pending === true,
  };

  return temp;
}
