import "server-only";

import type { RpcChain } from "@/lib/rpc";

import { parseSnapshot, snapshotResponse, type GroupedResponse, type Snapshot } from "./cache";
import { attachRewards, rewardsReadsFor } from "./merkl/store";
import { getPoolsReadRedis } from "./redis";
import { fetchedGroups, protocolChainOf, type Group } from "./registry";
import { CHAINS } from "./rpc/chains";
import { v3Key } from "./rpc/store";

/*
 * Every group is served from the RPC pipeline's key for its chain, `active-uniswap-<chain>-grouped:v3`, which
 * holds the chain's active pools. A failed cron run leaves the previous hash in place and nothing expires it,
 * so without an age limit a stopped job's values would be served as current indefinitely; a payload past its
 * limit is treated as missing.
 */

/**
 * The v3 key, written every 5 minutes, holds the metrics and the daily rows together. Past an hour, 12 missed
 * runs, the whole group is unavailable.
 */
export const V3_MAX_AGE_MS = 60 * 60 * 1000;

/** Three 5-minute runs: a v3 payload's data is up to one run older at read time than when it was written. */
export const V3_WRITE_GRACE_MS = 15 * 60 * 1000;

/**
 * How far a v3 payload's data (its `indexedAt`, the finalized block's time) may trail the clock before its
 * 24h volume, fees and window stop describing the last 24 hours: the chain's lag limit (the finalized block
 * already trails the head by up to about 21 minutes on Base) plus V3_WRITE_GRACE_MS. Past it they read null
 * ("Unavailable"), while TVL and the charts are still served until V3_MAX_AGE_MS.
 */
export const v3WindowMaxLagMs = (chain: RpcChain) => CHAINS[chain].lagLimitSeconds * 1000 + V3_WRITE_GRACE_MS;

/** The pools of a v3 payload with the 24h values withheld. */
function withoutWindow(snapshot: Snapshot): Snapshot {
  const data = snapshot.data.map(pool => (pool.metrics ? { ...pool, metrics: { ...pool.metrics, volume24h: null, fees24h: null, window: null } } : pool));
  return { ...snapshot, data };
}

/** The snapshot when it is no older than `maxAgeMs` at `now`, otherwise null. */
const fresh = (snapshot: Snapshot | null, maxAgeMs: number, now: number): Snapshot | null =>
  snapshot && now - snapshot.fetchedAt <= maxAgeMs ? snapshot : null;

/** A group's response from its v3 key within its age limits, with the 24h values withheld once its data trails the chain's limit. Null when missing or too old. */
function v3Response(chain: RpcChain, snapshot: Snapshot | null, now: number): GroupedResponse | null {
  let v3 = fresh(snapshot, V3_MAX_AGE_MS, now);
  if (v3 && (v3.indexedAt === null || now - v3.indexedAt > v3WindowMaxLagMs(chain))) v3 = withoutWindow(v3);
  return v3 && snapshotResponse(v3);
}

/** The fields of a raw `hgetall` reply, `[field, value, ...]`. Null for a missing key (an empty reply). */
function hashOf(reply: unknown): Record<string, unknown> | null {
  if (!Array.isArray(reply) || reply.length === 0) return null;
  const hash: Record<string, unknown> = {};
  for (let i = 0; i + 1 < reply.length; i += 2) hash[String(reply[i])] = reply[i + 1];
  return hash;
}

/** Why a group could not be served: no fresh data cached, or the read threw. */
export type GroupFailure = "unavailable" | "error";

/** Body of GET /api/pools. A group is in exactly one of `groups` and `failed`. */
export type PoolsResponse = {
  groups: Partial<Record<Group, GroupedResponse>>;
  failed: Partial<Record<Group, GroupFailure>>;
};

// Groups already reported as having no fresh cached data in this instance. A group stays unavailable until its
// cron succeeds, so it is logged once per instance rather than on every request.
const reportedUnavailable = new Set<Group>();

/**
 * Reads every group's v3 key in one pipelined request (one round trip; Upstash still bills each command).
 * Errors are kept per command, so a group whose key failed is marked `"error"` and the others still load.
 * When the request as a whole fails, every group is an `"error"`. Every group's age limits are checked
 * against one clock reading taken when the reads return.
 */
export async function readAllGrouped(groups: readonly Group[] = fetchedGroups()): Promise<PoolsResponse> {
  const body: PoolsResponse = { groups: {}, failed: {} };
  if (groups.length === 0) return body;

  const pipeline = getPoolsReadRedis().pipeline();
  for (const group of groups) pipeline.hgetall(v3Key(protocolChainOf(group).chain));
  const rewardsReads = rewardsReadsFor(groups);
  for (const { key } of rewardsReads) pipeline.hgetall(key);

  let replies: { result?: unknown; error?: string }[];
  try {
    replies = await pipeline.exec({ keepErrors: true });
  } catch (err) {
    console.error("Pool data read failed", err);
    for (const group of groups) body.failed[group] = "error";
    return body;
  }

  const now = Date.now();
  const hasError = (reply: (typeof replies)[number] | undefined) => reply?.error !== undefined && reply?.error !== null;
  groups.forEach((group, i) => {
    const reply = replies[i];
    if (hasError(reply)) {
      console.error(`Pool data read failed for ${group}`, reply?.error);
      body.failed[group] = "error";
      return;
    }

    const response = v3Response(protocolChainOf(group).chain, parseSnapshot(hashOf(reply?.result)), now);
    if (response === null) {
      if (!reportedUnavailable.has(group)) {
        reportedUnavailable.add(group);
        console.warn(`No fresh cached pool data for ${group}`);
      }
      body.failed[group] = "unavailable";
    } else {
      reportedUnavailable.delete(group);
      body.groups[group] = response;
    }
  });

  // Merkl rewards follow the group keys. A failed rewards read leaves that chain's rewards null and the group loaded.
  rewardsReads.forEach(({ group, key }, i) => {
    const reply = replies[groups.length + i];
    if (hasError(reply)) console.error(`Rewards read failed for ${key}`, reply?.error);
    attachRewards(body.groups[group], hasError(reply) ? null : parseSnapshot(hashOf(reply?.result)), now);
  });
  return body;
}
