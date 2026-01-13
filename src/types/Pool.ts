import { PoolAsset } from "./PoolAsset";
import { StakeAddress } from "./StakeAddress";
import { RewardsToken } from "./RewardsToken";

export interface Pool {
  id: number;
  attributes: {
    name?: string;
    protocol?: "balancer" | "quickswap" | "dfx" | "uniswap";
    pool_address?: string;
    subgraph_id?: string;
    rewards_type?: "single" | "double" | "multi";
    rewards_interval?: string;
    link_add_liquidity?: string;
    link_pool_analytics?: string;
    link_block_explorer?: string;
    staking_period?: string;
    notice?: string;
    rewards_tokens: { data: RewardsToken[] };
    stake_addresses: { data: StakeAddress[] };
    pool_assets: { data: PoolAsset[] };
    active?: boolean;
  };
}
