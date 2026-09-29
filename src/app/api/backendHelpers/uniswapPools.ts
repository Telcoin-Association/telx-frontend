import "server-only";
import pools from "@/data/pool.json";
import type { RpcChain } from "@/lib/rpc";

export type UniswapV4Pool = {
  /** The v4 pool id as stored in pool.json. */
  poolId: `0x${string}`;
  amount0Decimals: number;
  amount1Decimals: number;
};

const poolKey = (chain: string, poolId: string) => `${chain}:${poolId.trim().toLowerCase()}`;

// Every Uniswap v4 pool in the registry with its token decimals, keyed by chain and pool id. Inactive pools
// stay in the map because users can still hold positions in them.
const UNISWAP_V4_POOLS = new Map<string, UniswapV4Pool>();
for (const { attributes } of pools as Array<{ attributes: Record<string, any> }>) {
  const decimals = attributes.decimals;
  if (attributes.protocol !== "uniswap" || attributes.protocol_version !== "v4") continue;
  if (!Number.isInteger(decimals?.amount0Decimals) || !Number.isInteger(decimals?.amount1Decimals)) continue;
  UNISWAP_V4_POOLS.set(poolKey(attributes.blockchain, attributes.pool_address), {
    poolId: attributes.pool_address,
    amount0Decimals: decimals.amount0Decimals,
    amount1Decimals: decimals.amount1Decimals,
  });
}

/**
 * The registered Uniswap v4 pool with id `poolId` on `chain`, or null when pool.json does not list one.
 * The positions routes use this to reject unknown pools before any upstream call and to take the token
 * decimals from the registry rather than from the request.
 */
export function findUniswapV4Pool(chain: RpcChain, poolId: string | null): UniswapV4Pool | null {
  if (!poolId) return null;
  return UNISWAP_V4_POOLS.get(poolKey(chain, poolId)) ?? null;
}

/** Every registered Uniswap v4 pool on `chain`, inactive ones included, in pool.json order. */
export function listUniswapV4Pools(chain: RpcChain): UniswapV4Pool[] {
  const prefix = `${chain}:`;
  return [...UNISWAP_V4_POOLS].filter(([key]) => key.startsWith(prefix)).map(([, pool]) => pool);
}
