import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType } from "../all/createStakingContract";
import { quickswapGetStakeInfo } from "./getStakeInfo";
import { Decimals } from "../uniswapv4/getSingleContractData";
import type { Position } from "@/lib/positions";
import { PoolActivityFields } from "@/helpers/poolMetrics";

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

export type QuickswapContractData = PoolActivityFields & {
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
  decimals?: Decimals;
  positions?: Position[];
};

/**
 * Loads a QuickSwap pool. There is no source for a QuickSwap pool's TVL, volume, fees or history, which read
 * as unknown; the stake reads cover the connected wallet's balances and rewards.
 */
export async function quickswapGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined
): Promise<QuickswapContractData> {
  const poolAddress = value.pool;
  const type = value.rewards.type as ContractType;
  const stakeLiquidity = () => Promise.resolve(null);

  let stakeAddress = value.activeStakingAddress?.address;
  const deprecatedContractPresent =
    value.deprecatedStakingAddresses?.length > 0;

  let stakeInfo: any;

  if (stakeAddress) {
    stakeInfo = await quickswapGetStakeInfo(
      stakeAddress,
      poolAddress,
      type,
      stakeLiquidity,
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
      stakeLiquidity,
      value,
      selectedWalletAddress
    );
  }

  const contractData: QuickswapContractData = {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    active: value.active,
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
    totalLiquidity: null,
    stakedLiquidity: stakeInfo.stakedLiquidity ?? null,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics,
    userStaked: true,
    selectedWalletAddress: selectedWalletAddress,
    dailyVolumeUSD: null,
    fees24hr: null,
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
    liquidityChartData: [],
    volumeChartData: [],
  };
  return contractData;
}
