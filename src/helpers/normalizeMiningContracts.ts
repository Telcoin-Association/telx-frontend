export interface miningContractFields {
  id: number;
  attributes: {
    name: string;
    protocol: string | null;
    protocol_version?: string | null;
    network: string;
    pool_address: string;
    subgraph_id: string | null;
    rewards_type: string;
    rewards_interval: string | null;
    link_add_liquidity: string;
    link_pool_analytics: string | null;
    link_block_explorer: string;
    staking_period: string | null;
    notice: string | null;
    active: boolean;
    fetchSubgraph: boolean;
    hidden?: boolean;
    blockchain: string;
    rewards_tokens: {
      data: Array<{
        id: number;
        attributes: {
          name: string;
        };
      }>;
    };
    stake_addresses: {
      data: Array<{
        id: number;
        attributes: {
          address: string;
          start_date: string;
          end_date: string | null;
          active: boolean;
          pool: string;
        };
      }>;
    };
    pool_assets: {
      data: Array<{
        id: number;
        attributes: {
          name: string;
        };
      }>;
    };
    decimals?: {
      amount0Decimals: number,
      amount1Decimals: number
    }
  };
}

export const normalizeMiningContract = (data: miningContractFields) => {
  if (!data || !data.attributes) {
    throw new Error("Data is missing required attributes property");
  }
  const attributes = data.attributes;

  const {
    name,
    protocol,
    pool_address,
    subgraph_id,
    rewards_type,
    rewards_interval,
    link_add_liquidity,
    link_pool_analytics,
    link_block_explorer,
    staking_period,
    rewards_tokens,
    stake_addresses,
    pool_assets,
    active,
    fetchSubgraph,
    blockchain,
    decimals,
    protocol_version
  } = attributes;

  const rewards = {
    type: rewards_type,
    tokens: rewards_tokens.data.map(reward => ({
      amount: Number(reward.attributes.name.split(" ")[1]),
      ticker: reward.attributes.name.split(" ")[0],
    })),
    rewardsInterval: rewards_interval,
  };

  const assets = pool_assets.data.map(asset => ({
    ticker: asset.attributes.name.split(" ")[0],
    weight: Number(asset.attributes.name.split(" ")[1]),
  }));

  const links = {
    addLiquidity: link_add_liquidity,
    blockExplorer: link_block_explorer,
    poolAnalytics: link_pool_analytics,
  };

  const activeStakingAddress = stake_addresses?.data?.find(stake => stake.attributes.active);

  const deprecatedStakingAddresses = stake_addresses?.data?.filter(stake => !stake.attributes.active);

  return {
    activeStakingAddress: activeStakingAddress ? activeStakingAddress.attributes : undefined,
    deprecatedStakingAddresses: deprecatedStakingAddresses?.map(stake => stake.attributes),
    rewards: rewards,
    assets: assets,
    links: links,
    stakingPeriod: staking_period,
    name: name,
    pool: pool_address,
    protocol: protocol,
    protocolVersion: protocol_version,
    blockchain: blockchain ? blockchain : "",
    subgraphId: subgraph_id,
    vestingPeriod: "",
    vestingPeriodHelpText: "",
    deprecated: !active,
    fetchSubgraph: fetchSubgraph,
    stake: activeStakingAddress,
    stakeAddressNew: "",
    illustration: "",
    rewardsInterval: rewards_interval,
    deprecatedContractPresent: deprecatedStakingAddresses?.length > 0 ? true : false,
    decimals,
  };
};

export type miningContract = ReturnType<typeof normalizeMiningContract>;

export const normalizeMiningContracts = (response: miningContractFields[]): miningContract[] => {
  return response
    .filter((data) => !data.attributes?.hidden)
    .map(normalizeMiningContract);
};


