import { dfxGetStakeInfo } from "./getStakeInfo";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType } from "../all/createStakingContract";
import { ProtocolsContractData } from "../shared";
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

export type DfxContractData = PoolActivityFields & {
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
  totalLiquidity: number | null;
  stakedLiquidity?: number | null;
  addLiquidityLink?: string;
  poolAnalyticsLink?: string | null;
  userStaked: boolean;
  selectedWalletAddress: string | undefined;
  dailyVolumeUSD: number | null;
  illustration?: string;
  subgraphId?: string;
  user: UserInfo;
  stakingPeriod?: any;
  deprecatedContractPresent?: boolean;
  fees24hr: number | null;
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

  // There is no source for a DFX pool's liquidity, so the stake reads value stakes against 0.
  const totalLiquidity = 0;

  let stakeAddress = value.activeStakingAddress?.address;
  let stakeInfo;
  if (stakeAddress) {
    stakeInfo = await dfxGetStakeInfo(
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
      totalLiquidity,
      value,
      selectedWalletAddress
    );
  }

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
    dailyVolumeUSD: null,
    illustration: value.illustration,
    subgraphId: subgraphId || '',
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
    fees24hr: null,
    vestingPeriod: undefined, // added for type support
    vestingPeriodHelpText: undefined, // added for type support
    totalStaked: stakeInfo?.totalStaked || 0,
    totalSupply: stakeInfo?.totalSupply || 0,
    liquidityChartData: [],
    volumeChartData: [],
  };
  return contractData;
}
