import pools from "@/data/pool.json";

type RegistryEntry = { attributes: { pool_address?: string | null; blockchain?: string | null; protocol?: string | null; hidden?: boolean | null } };

const lower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/**
 * The chains a pool id is listed on in the registry, among the entries the app shows (not `hidden`). The id is
 * matched without regard to case, since links may lowercase a checksummed address. Empty when the registry
 * does not list the id, so the page can answer 404.
 */
export function registryChainsFor(poolId: string, registry: readonly RegistryEntry[] = pools as RegistryEntry[]): string[] {
  const id = lower(poolId);
  const chains = registry
    .filter(({ attributes }) => !attributes.hidden && lower(attributes.pool_address) === id)
    .map(({ attributes }) => lower(attributes.blockchain));
  return [...new Set(chains)].filter(Boolean);
}

/** The ids the registry shows, once each, as the pool page's static params. */
export function registryPoolIds(registry: readonly RegistryEntry[] = pools as RegistryEntry[]): string[] {
  const ids = registry.filter(({ attributes }) => !attributes.hidden).map(({ attributes }) => attributes.pool_address);
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

type LoadedPool = { poolContractAddress?: string; blockchain?: string };

/**
 * What a pool page shows for `poolId` and the `chain` search param, given the loaded pools:
 * - `found`: the loaded pool, matched on id without regard to case and, when a chain is named or the id is
 *   on one chain only, on that chain
 * - `choose`: the id is loaded on several chains and none was named, so the page offers them
 * - `missing`: nothing loaded matches
 */
export type PoolLookup<T> = { kind: "found"; pool: T } | { kind: "choose"; chains: string[] } | { kind: "missing" };

export function findLoadedPool<T extends LoadedPool>(poolId: string, chain: string | undefined, loaded: readonly T[]): PoolLookup<T> {
  const id = lower(poolId);
  const matches = loaded.filter((pool) => lower(pool.poolContractAddress) === id);
  const wanted = chain ? matches.filter((pool) => lower(pool.blockchain) === lower(chain)) : matches;
  const chains = [...new Set(wanted.map((pool) => lower(pool.blockchain)))];
  if (wanted.length > 0 && (chains.length <= 1 || chain)) return { kind: "found", pool: wanted[0] };
  if (!chain && chains.length > 1) return { kind: "choose", chains };
  // A named chain the pool is not on: offer the chains it is on.
  const elsewhere = [...new Set(matches.map((pool) => lower(pool.blockchain)))];
  if (chain && elsewhere.length > 0) return { kind: "choose", chains: elsewhere };
  return { kind: "missing" };
}
