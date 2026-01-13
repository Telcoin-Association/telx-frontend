import { PoolAsset } from "./PoolAsset";

export interface PoolGeneralized {
  id: number;
  attributes: {
    name?: string;
    pool_address?: string;
    link_add_liquidity?: string;
    active?: boolean | null;
    pool_assets: { data: PoolAsset[] };
  };
}
