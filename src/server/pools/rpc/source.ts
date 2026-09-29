import "server-only";

import type { RpcChain } from "@/lib/rpc";

import { getRedis } from "../redis";
import type { Group } from "../registry";

/**
 * Which data a Uniswap group is served from: `v2`, the subgraph keys, or `v3`, the RPC pipeline's key.
 * DEFAULT_GROUP_SOURCES holds the deployed choice; the `config:grouped-source` hash (group to `v2` or `v3`)
 * overrides it per group without a deploy, for the rollout and for a rollback.
 */

export type GroupSource = "v2" | "v3";

export const GROUPED_SOURCE_KEY = "config:grouped-source";

export const DEFAULT_GROUP_SOURCES: Readonly<Partial<Record<Group, GroupSource>>> = { "uniswap-polygon": "v3" };

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
    if (v3ChainOf(group as Group) && (value === "v2" || value === "v3")) sources[group as Group] = value;
  }
  return sources;
}

/** The source of every group, read on its own (the health check). A failed read falls back to the defaults. */
export async function readGroupSources(): Promise<Partial<Record<Group, GroupSource>>> {
  try {
    return resolveGroupSources(await getRedis().hgetall<Record<string, unknown>>(GROUPED_SOURCE_KEY));
  } catch (err) {
    console.error("Could not read config:grouped-source; using the default sources", err);
    return resolveGroupSources(null);
  }
}
