import { getStakeInfo } from "./getStakeInfo";
import { getRewardsValuesNoStakingContract } from "./getRewardsValues";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType } from "../all/createStakingContract";
import { getPoolLiquidityValue } from "@/web3/getContracts/balancer/vault";
import { Decimals } from "../uniswapv4/getSingleContractData";
import type { Position } from "@/lib/positions";
import { GroupedPool } from "@/helpers/fetchGroupedSubgraph";
import { activityFields, PoolActivityFields } from "@/helpers/poolMetrics";

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

export type BalancerContractData = PoolActivityFields & {
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
  illustration: string;
  dailyVolumeUSD: number | null;
  user: UserInfo;
  stakingPeriod: any;
  subgraphId: string;
  vestingPeriod: any;
  vestingPeriodHelpText: string;
  fees24hr: number | null;
  totalStaked: number | null;
  totalSupply: number | null;
  liquidityChartData: any;
  volumeChartData: any;
  decimals?: Decimals;
  positions?: Position[];
};

// Decimals of the tokens held by the TELx Balancer pools, by lowercase address.
const TOKEN_DECIMALS: Record<string, number> = {
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

/**
 * Loads a Balancer pool. An active pool reads its TVL from the Vault and its volume, fees and charts from the
 * grouped pool data. An inactive pool shows no live figures: its TVL is priced only when the connected wallet
 * has a stake to value, and `getTokenPrices` is called only then.
 */
export async function balancerGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined,
  getTokenPrices: () => Promise<Record<string, number>>,
  subgraphInfoForBalancerPool: GroupedPool | undefined
): Promise<BalancerContractData> {
  const poolAddress = value.pool;
  const type = value.rewards.type as ContractType;
  const subgraphId = value.subgraphId;

  // The Vault prices the pool from its balances; memoised so the stake reads share one read.
  let liquidity: Promise<number | null> | undefined;
  const poolLiquidity = () =>
    (liquidity ??= subgraphId
      ? getTokenPrices().then(prices => getPoolLiquidityValue(`${subgraphId}`, TOKEN_DECIMALS, prices))
      : Promise.resolve(null));

  const subgraphInfo = value.active ? (subgraphInfoForBalancerPool as any) : undefined;
  const metrics = value.active ? subgraphInfoForBalancerPool?.metrics : undefined;

  let totalLiquidity: number | null = null;
  let dailyVolumeUSD: number | null = null;
  let fees24hr: number | null = null;

  let liquidityChartData = [] as any;
  let volumeChartData = [] as any;

  if (value.active) {
    totalLiquidity = await poolLiquidity();
  }

  if (subgraphInfo) {
    if (metrics) {
      dailyVolumeUSD = metrics.volume24h;
      fees24hr = metrics.fees24h;
    } else if (metrics === null) {
      // v2 payload whose hourly part is missing: volume and fees are unknown, not zero.
    } else if (subgraphInfo?.poolSnapshots?.length > 0) {
      // Legacy payload without metrics: difference of the cumulative daily snapshots.
      const [first, second] = subgraphInfo.poolSnapshots;
      if (!second) {
        dailyVolumeUSD = Number(first.swapVolume);
        fees24hr = Number(first.swapFees);
      } else {
        dailyVolumeUSD = Number(second.swapVolume) - Number(first.swapVolume);
        fees24hr = Number(second.swapFees) - Number(first.swapFees);
      }
    }
  }
  if (subgraphInfo?.threeMonthLiquidityData?.length > 0) {
    liquidityChartData = subgraphInfo.threeMonthLiquidityData;
  }

  if (subgraphInfo?.threeMonthLiquidityData?.length > 0) {
    const sortedVolumeData = [...subgraphInfo.threeMonthLiquidityData].sort(
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
      poolLiquidity,
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
      poolLiquidity,
      value,
      selectedWalletAddress
    );
  }

  const contractData: any = {
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
    fees24hr,
    ...activityFields(metrics),
    totalStaked: stakeInfo?.totalStaked || null,
    totalSupply: stakeInfo?.totalSupply || null,
    liquidityChartData: liquidityChartData, //
    volumeChartData: volumeChartData,//
  };

  return contractData;
}
