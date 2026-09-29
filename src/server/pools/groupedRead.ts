import "server-only";

import {
  dailyKey,
  hourlyKey,
  mergeGroupedParts,
  parseSnapshot,
  quickswapKey,
  singlePartResponse,
  type GroupedResponse,
  type Snapshot,
} from "./cache";
import { attachRewards, rewardsReadsFor } from "./merkl/store";
import { getPoolsReadRedis } from "./redis";
import { fetchedGroups, type Group } from "./registry";

/** The data keys one group is read from. Split groups have an hourly and a daily key; QuickSwap has one. */
const keysOf = (group: Group): string[] => (group === "quickswap" ? [quickswapKey] : [hourlyKey(group), dailyKey(group)]);

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

/** The snapshot when it is no older than `maxAgeMs` at `now`, otherwise null. */
const fresh = (snapshot: Snapshot | null, maxAgeMs: number, now: number): Snapshot | null =>
  snapshot && now - snapshot.fetchedAt <= maxAgeMs ? snapshot : null;

/**
 * One group's response from its parsed keys, in `keysOf` order, with parts past their age limit at `now`
 * left out. Split groups merge their hourly and daily keys; one part alone is served as it is (the two
 * crons run on different schedules, so one part can briefly be missing). Null when the group has no
 * fresh data at all.
 */
function groupResponse(group: Group, snapshots: (Snapshot | null)[], now: number): GroupedResponse | null {
  if (group === "quickswap") {
    const snapshot = fresh(snapshots[0], QUICKSWAP_MAX_AGE_MS, now);
    return snapshot && singlePartResponse(snapshot);
  }
  const [hourly, daily] = snapshots;
  return mergeGroupedParts(fresh(hourly, HOURLY_MAX_AGE_MS, now), fresh(daily, DAILY_MAX_AGE_MS, now));
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
 * limits are checked against one clock reading taken when the reads return.
 */
export async function readAllGrouped(groups: readonly Group[] = fetchedGroups()): Promise<PoolsResponse> {
  const body: PoolsResponse = { groups: {}, failed: {} };
  if (groups.length === 0) return body;

  const keys = groups.map(keysOf);
  const pipeline = getPoolsReadRedis().pipeline();
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
  let next = 0;
  groups.forEach((group, i) => {
    const groupReplies = replies.slice(next, next + keys[i].length);
    next += keys[i].length;

    const failed = groupReplies.filter(reply => reply.error !== undefined && reply.error !== null);
    if (failed.length) {
      console.error(`Pool data read failed for ${group}`, failed.map(reply => reply.error).join("; "));
      body.failed[group] = "error";
      return;
    }

    const response = groupResponse(
      group,
      groupReplies.map(reply => parseSnapshot(hashOf(reply.result))),
      now,
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
