import "server-only";

import type { RpcChain } from "@/lib/rpc";

import {
  dailyKey,
  hourlyKey,
  mergeGroupedParts,
  mergeMixedParts,
  parseSnapshot,
  quickswapKey,
  singlePartResponse,
  type GroupedResponse,
  type Snapshot,
} from "./cache";
import { attachRewards, rewardsReadsFor } from "./merkl/store";
import { getPoolsReadRedis } from "./redis";
import { fetchedGroups, poolsFor, type Group } from "./registry";
import { CHAINS } from "./rpc/chains";
import { GROUPED_SOURCE_KEY, resolveGroupSources, v3ChainOf, type GroupSource } from "./rpc/source";
import { v3Key } from "./rpc/store";

/**
 * The data keys one group is read from. Split groups have an hourly and a daily key; QuickSwap has one. A
 * Uniswap group also has the RPC pipeline's v3 key, read alongside so that the source switch costs no extra
 * round trip; `groupResponse` uses the keys of the group's source.
 */
function keysOf(group: Group): string[] {
  if (group === "quickswap") return [quickswapKey];
  const chain = v3ChainOf(group);
  return chain ? [hourlyKey(group), dailyKey(group), v3Key(chain)] : [hourlyKey(group), dailyKey(group)];
}

/*
 * Age limits for serving a cached part, measured from its `fetchedAt`. A failed cron run leaves the
 * previous hash in place and nothing expires it, so without a limit a stopped job's values would be
 * served as current indefinitely. A part past its limit is treated as missing.
 */

/**
 * Hourly part, written every 5 minutes: an hour is 12 missed runs in a row. It is the only part with
 * `metrics`, whose "24h" volume and fees stop describing the last 24 hours as it ages, so a stale hourly
 * part leaves every pool with `metrics: null` ("Unavailable").
 */
export const HOURLY_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Daily part, written hourly: 95 days of daily rows for the charts. A day of rows plus two hours of
 * missed runs, so chart history survives a short outage but not a job that has stopped.
 */
export const DAILY_MAX_AGE_MS = 26 * 60 * 60 * 1000;

/**
 * QuickSwap's single key, written hourly, carries the rows its readers sum into 24h figures. Three
 * missed runs, the same limit the health check uses for hourly keys.
 */
export const QUICKSWAP_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * The RPC pipeline's v3 key, written every 5 minutes, holds the metrics and the daily rows together. It
 * takes the hourly part's limit, 12 missed runs; past it the whole group is unavailable.
 */
export const V3_MAX_AGE_MS = HOURLY_MAX_AGE_MS;

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

/** A v3 payload served within its age limits, with the 24h values withheld once its data trails the chain's limit. */
function v3Response(chain: RpcChain, snapshot: Snapshot | null, now: number): GroupedResponse | null {
  let v3 = fresh(snapshot, V3_MAX_AGE_MS, now);
  if (v3 && (v3.indexedAt === null || now - v3.indexedAt > v3WindowMaxLagMs(chain))) v3 = withoutWindow(v3);
  return v3 && mergeGroupedParts(v3, v3);
}

/** The ids of a chain's active Uniswap pools in the registry, the pools a `mixed` group takes from its v3 key. */
const activeIdsOf = (chain: RpcChain): string[] => poolsFor("uniswap", chain).flatMap(pool => (pool.active ? [pool.id] : []));

/**
 * One group's response from its parsed keys, in `keysOf` order, with parts past their age limit at `now`
 * left out. Split groups merge their hourly and daily keys; one part alone is served as it is (the two
 * crons run on different schedules, so one part can briefly be missing). A group whose source is `v3` is
 * served from the v3 key alone, as both parts. A `mixed` group takes its active pools from the v3 key and
 * its archived pools from the hourly and daily keys (see `mergeMixedParts`), each side under its own age
 * limits. Null when the group has no fresh data at all.
 */
function groupResponse(group: Group, snapshots: (Snapshot | null)[], now: number, source: GroupSource = "v2"): GroupedResponse | null {
  const chain = v3ChainOf(group);
  if (chain && source === "v3") return v3Response(chain, snapshots[2], now);
  if (group === "quickswap") {
    const snapshot = fresh(snapshots[0], QUICKSWAP_MAX_AGE_MS, now);
    return snapshot && singlePartResponse(snapshot);
  }
  const [hourly, daily] = snapshots;
  const subgraph = mergeGroupedParts(fresh(hourly, HOURLY_MAX_AGE_MS, now), fresh(daily, DAILY_MAX_AGE_MS, now));
  if (chain && source === "mixed") return mergeMixedParts(v3Response(chain, snapshots[2], now), snapshots[2], subgraph, activeIdsOf(chain));
  return subgraph;
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
 * Reads every group the registry fetches in one pipelined request (one round trip; Upstash still bills
 * each command). Errors are kept per command, so a group whose key failed is marked `"error"` and the
 * others still load. When the request as a whole fails, every group is an `"error"`. Every group's age
 * limits are checked against one clock reading taken when the reads return. The same request reads
 * `config:grouped-source`, which picks each Uniswap group's source; if that read fails the defaults apply.
 */
export async function readAllGrouped(groups: readonly Group[] = fetchedGroups()): Promise<PoolsResponse> {
  const body: PoolsResponse = { groups: {}, failed: {} };
  if (groups.length === 0) return body;

  const keys = groups.map(keysOf);
  const pipeline = getPoolsReadRedis().pipeline();
  pipeline.hgetall(GROUPED_SOURCE_KEY);
  for (const key of keys.flat()) pipeline.hgetall(key);
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
  const [sourceReply] = replies;
  if (sourceReply?.error) console.error("Could not read config:grouped-source; using the default sources", sourceReply.error);
  const sources = resolveGroupSources(sourceReply?.error ? null : hashOf(sourceReply?.result));

  let next = 1;
  groups.forEach((group, i) => {
    const source = sources[group] ?? "v2";
    const allReplies = replies.slice(next, next + keys[i].length);
    next += keys[i].length;
    // Only the keys of the group's source are parsed, and only the keys its active pools come from decide whether
    // it failed: a failed subgraph read in a `mixed` group leaves out its archived rows and keeps the group.
    const isV3Group = v3ChainOf(group) !== null;
    const mixed = isV3Group && source === "mixed";
    const groupReplies: ((typeof replies)[number] | undefined)[] =
      !isV3Group || mixed ? allReplies : source === "v3" ? [undefined, undefined, allReplies[2]] : allReplies.slice(0, 2);
    const deciding = mixed ? [allReplies[2]] : groupReplies;

    const hasError = (reply: (typeof replies)[number] | undefined) => reply?.error !== undefined && reply?.error !== null;
    const archivedErrors = mixed ? allReplies.slice(0, 2).filter(hasError) : [];
    if (archivedErrors.length) console.error(`Archived pool data read failed for ${group}`, archivedErrors.map(reply => reply?.error).join("; "));
    const failed = deciding.filter(hasError);
    if (failed.length) {
      console.error(`Pool data read failed for ${group}`, failed.map(reply => reply?.error).join("; "));
      body.failed[group] = "error";
      return;
    }

    const response = groupResponse(
      group,
      groupReplies.map(reply => (reply ? parseSnapshot(hashOf(reply.result)) : null)),
      now,
      source,
    );
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
    const reply = replies[next + i];
    if (reply?.error !== undefined && reply?.error !== null) console.error(`Rewards read failed for ${key}`, reply.error);
    attachRewards(body.groups[group], reply?.error ? null : parseSnapshot(hashOf(reply?.result)), now);
  });
  return body;
}
