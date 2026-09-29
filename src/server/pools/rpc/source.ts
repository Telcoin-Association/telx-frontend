import "server-only";

import type { RpcChain } from "@/lib/rpc";

import { getRedis } from "../redis";
import type { Group } from "../registry";

/**
 * Which data a Uniswap group is served from:
 * - `v2`: the subgraph keys, for every pool of the group;
 * - `v3`: the RPC pipeline's key, which holds the active pools only;
 * - `mixed`: the v3 key for the active pools and the subgraph keys for the archived ones, so a chain with
 *   archived pools gets chain-derived values for its active pools without losing the archived rows.
 * DEFAULT_GROUP_SOURCES holds the deployed choice; the `config:grouped-source` hash (group to one of the
 * values above) overrides it per group without a deploy, for the rollout and for a rollback.
 */

export type GroupSource = "v2" | "v3" | "mixed";

const GROUP_SOURCE_VALUES: readonly unknown[] = ["v2", "v3", "mixed"] satisfies GroupSource[];

export const GROUPED_SOURCE_KEY = "config:grouped-source";

/**
 * Polygon's subgraph keys are empty (the gateway refuses its subgraph), so it has nothing archived to add
 * and stays on `v3`. Base and Ethereum have archived pools only the subgraph keys carry.
 */
export const DEFAULT_GROUP_SOURCES: Readonly<Partial<Record<Group, GroupSource>>> = {
  "uniswap-polygon": "v3",
  "uniswap-base": "mixed",
  "uniswap-ethereum": "mixed",
};

const V3_CHAINS: Readonly<Partial<Record<Group, RpcChain>>> = {
  "uniswap-polygon": "polygon",
  "uniswap-base": "base",
  "uniswap-ethereum": "ethereum",
};

/** The chain of a group that can be served from the RPC pipeline, or null. */
export const v3ChainOf = (group: Group): RpcChain | null => V3_CHAINS[group] ?? null;

/** The source of every group, from the defaults and the fields of the override hash (null when it is missing). */
export function resolveGroupSources(overrides: Record<string, unknown> | null): Partial<Record<Group, GroupSource>> {
  const sources: Partial<Record<Group, GroupSource>> = { ...DEFAULT_GROUP_SOURCES };
  for (const [group, value] of Object.entries(overrides ?? {})) {
    if (v3ChainOf(group as Group) && GROUP_SOURCE_VALUES.includes(value)) sources[group as Group] = value as GroupSource;
  }
  return sources;
}

/**
 * The keys whose freshness decides a group's health: its subgraph keys under `v2`, its v3 key otherwise. A
 * `mixed` group's header and active pools come from the v3 key, so its subgraph keys, which carry only its
 * archived rows, are reported but do not gate.
 */
export const gatingKeysOf = (source: GroupSource): "v2" | "v3" => (source === "v2" ? "v2" : "v3");

/** The source of every group, read on its own (the health check). A failed read falls back to the defaults. */
export async function readGroupSources(): Promise<Partial<Record<Group, GroupSource>>> {
  try {
    return resolveGroupSources(await getRedis().hgetall<Record<string, unknown>>(GROUPED_SOURCE_KEY));
  } catch (err) {
    console.error("Could not read config:grouped-source; using the default sources", err);
    return resolveGroupSources(null);
  }
}
