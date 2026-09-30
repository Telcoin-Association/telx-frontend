import "server-only";

import poolJson from "@/data/pool.json";
import type { PoolGroup } from "@/types/PoolMetrics";

import { CHAINS, type ChainConfig } from "./rpc/chains";

/**
 * The server's pool registry: the Uniswap v4 pools of src/data/pool.json, so that the UI and the data pipeline
 * read one list. The RPC pipeline reads the active ones; archived pools stay listed so that Merkl rewards and
 * pool ids resolve for them.
 */

export type Protocol = "uniswap";
export type Chain = "base" | "polygon" | "ethereum";
export type Group = PoolGroup;

/** A Uniswap v4 PoolKey. Currencies are lowercase; native ETH is the zero address. */
export type PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export type RegistryPool = {
  protocol: Protocol;
  chain: Chain;
  id: string; // lowercase v4 pool id
  name: string;
  active: boolean;
  /** Uniswap only: the pool key, the currency (0 or 1) volume is measured in, and the Initialize block. */
  key?: PoolKey;
  anchor?: 0 | 1;
  createdBlock?: number;
};

/** A Uniswap pool the RPC pipeline reads: an active registry pool with its key, anchor and creation block. */
export type RpcPool = RegistryPool & { key: PoolKey; anchor: 0 | 1; createdBlock: number };

/** The fields of a pool.json entry the registry reads. */
export type PoolJsonEntry = {
  attributes: {
    name: string;
    protocol: string | null;
    blockchain: string;
    pool_address: string;
    active: boolean;
    key?: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
    anchor?: number;
    createdBlock?: number;
  };
};

function uniswapFields(attributes: PoolJsonEntry["attributes"]): Pick<RegistryPool, "key" | "anchor" | "createdBlock"> {
  const { key, anchor, createdBlock } = attributes;
  const lower = (address: string) => address.trim().toLowerCase() as `0x${string}`;
  return {
    ...(key && {
      key: { currency0: lower(key.currency0), currency1: lower(key.currency1), fee: key.fee, tickSpacing: key.tickSpacing, hooks: lower(key.hooks) },
    }),
    ...((anchor === 0 || anchor === 1) && { anchor }),
    ...(Number.isInteger(createdBlock) && { createdBlock }),
  };
}

/**
 * Registry pools from pool.json's Uniswap entries. Throws when an entry has no pool id, or when an active pool
 * lacks the `key`, `anchor` or `createdBlock` the RPC pipeline reads. A bad pool.json edit then fails the
 * registry tests, and at runtime the pool data route and every cron report an error instead of silently
 * skipping the pool.
 */
export function buildRegistry(entries: readonly PoolJsonEntry[]): RegistryPool[] {
  return entries
    .filter(({ attributes }) => attributes.protocol === "uniswap")
    .map(({ attributes }) => {
      const id = attributes.pool_address?.trim().toLowerCase();
      if (!id) {
        throw new Error(`pool.json: ${attributes.name} has no pool id`);
      }
      const pool: RegistryPool = {
        protocol: "uniswap",
        chain: attributes.blockchain as Chain,
        id,
        name: attributes.name,
        active: attributes.active,
      };
      const fields = uniswapFields(attributes);
      if (pool.active && (!fields.key || fields.anchor === undefined || fields.createdBlock === undefined)) {
        throw new Error(`pool.json: active Uniswap pool ${attributes.name} needs key, anchor and createdBlock`);
      }
      return { ...pool, ...fields };
    });
}

export const registryPools: readonly RegistryPool[] = buildRegistry(poolJson as PoolJsonEntry[]);

export const GROUPS = ["uniswap-base", "uniswap-polygon", "uniswap-ethereum"] as const satisfies readonly Group[];

const GROUP_SOURCES: Record<Group, { protocol: Protocol; chain: Chain }> = {
  "uniswap-base": { protocol: "uniswap", chain: "base" },
  "uniswap-polygon": { protocol: "uniswap", chain: "polygon" },
  "uniswap-ethereum": { protocol: "uniswap", chain: "ethereum" },
};

/** All registry pools of a protocol/chain group (active and archived), one entry per id, active when any entry is. */
export function poolsFor(protocol: Protocol, chain: Chain): RegistryPool[] {
  const byId = new Map<string, RegistryPool>();
  for (const pool of registryPools) {
    if (pool.protocol !== protocol || pool.chain !== chain) continue;
    const seen = byId.get(pool.id);
    byId.set(pool.id, seen ? { ...seen, active: seen.active || pool.active } : pool);
  }
  return [...byId.values()];
}

/** Unique lowercase pool ids of a protocol/chain group. */
export function poolIdsFor(protocol: Protocol, chain: Chain): string[] {
  return poolsFor(protocol, chain).map(pool => pool.id);
}

/** The group of a chain's Uniswap pools. */
export function groupOf(protocol: Protocol, chain: Chain): Group {
  return `${protocol}-${chain}`;
}

export function protocolChainOf(group: Group): { protocol: Protocol; chain: Chain } {
  return { ...GROUP_SOURCES[group] };
}

/** Groups with at least one registry pool, in GROUPS order. */
export function fetchedGroups(): Group[] {
  return GROUPS.filter(group => {
    const { protocol, chain } = protocolChainOf(group);
    return poolsFor(protocol, chain).length > 0;
  });
}

/** The active Uniswap pools of a chain, one entry per id, which the RPC pipeline reads. */
export function rpcPoolsFor(chain: Chain): RpcPool[] {
  return poolsFor("uniswap", chain).filter(
    (pool): pool is RpcPool => pool.active && Boolean(pool.key) && pool.anchor !== undefined && pool.createdBlock !== undefined,
  );
}

export function chainConfig(chain: Chain): ChainConfig {
  return CHAINS[chain];
}
