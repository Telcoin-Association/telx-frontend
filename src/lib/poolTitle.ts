/**
 * Public names for pool pages. A pool.json entry's `name` is an internal registry label ("WETH/TEL polygon merkl"),
 * so pages are named from the pool's token symbols and chain instead ("WETH/TEL on Polygon").
 */

export interface RegistryPoolForTitle {
  attributes: {
    pool_address?: string | null;
    blockchain?: string | null;
    network?: string | null;
    active?: boolean | null;
    pool_assets?: { data?: Array<{ attributes?: { name?: string | null } | null }> | null } | null;
  };
}

const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  polygon: "Polygon",
  base: "Base",
  ethereum: "Ethereum",
};

export const SITE_NAME = "TELx";
export const DEFAULT_POOL_PAGE_TITLE = `Pool Details | ${SITE_NAME}`;

export function chainDisplayName(chain: string): string {
  const key = chain.trim().toLowerCase();
  return CHAIN_DISPLAY_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Token symbols in registry order. Asset names carry a weight for weighted pools ("TEL 80"), which is dropped. */
export function poolSymbols(pool: RegistryPoolForTitle): string[] {
  return (pool.attributes.pool_assets?.data ?? [])
    .map(asset => asset?.attributes?.name?.trim().split(/\s+/)[0] ?? "")
    .filter(symbol => symbol.length > 0);
}

/**
 * "WETH/TEL on Polygon" for a registry pool id, or null when the id is not in the registry.
 * A Uniswap v4 pool id can appear once per chain; when its entries span several chains the chain is left out,
 * because metadata is rendered per id and cannot tell which chain the visitor picked.
 */
export function poolDisplayName(pools: RegistryPoolForTitle[], poolID: string): string | null {
  const id = poolID.toLowerCase();
  const matches = pools.filter(pool => pool.attributes.pool_address?.toLowerCase() === id);
  if (matches.length === 0) return null;

  const primary = matches.find(pool => pool.attributes.active) ?? matches[0];
  const symbols = poolSymbols(primary);
  if (symbols.length === 0) return null;

  const chains = new Set(
    matches.map(pool => pool.attributes.blockchain ?? pool.attributes.network).filter((chain): chain is string => Boolean(chain)),
  );
  const pair = symbols.join("/");
  return chains.size === 1 ? `${pair} on ${chainDisplayName([...chains][0])}` : pair;
}

/** "WETH/TEL on Polygon | TELx" for a pool display name, or the generic pool title without one. */
export function poolPageTitle(poolName: string | null): string {
  return poolName ? `${poolName} | ${SITE_NAME}` : DEFAULT_POOL_PAGE_TITLE;
}
