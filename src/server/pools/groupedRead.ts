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
import { getPoolsReadRedis } from "./redis";
import { fetchedGroups, type Group } from "./registry";

/** The data keys one group is read from. Split groups have an hourly and a daily key; QuickSwap has one. */
const keysOf = (group: Group): string[] => (group === "quickswap" ? [quickswapKey] : [hourlyKey(group), dailyKey(group)]);

/**
 * One group's response from its parsed keys, in `keysOf` order. Split groups merge their hourly and daily
 * keys; one part alone is served as it is (the two crons run on different schedules, so one part can
 * briefly be missing). Null when the group has no data at all.
 */
function groupResponse(group: Group, snapshots: (Snapshot | null)[]): GroupedResponse | null {
  if (group === "quickswap") {
    const [snapshot] = snapshots;
    return snapshot && singlePartResponse(snapshot);
  }
  const [hourly, daily] = snapshots;
  return mergeGroupedParts(hourly, daily);
}

/** The fields of a raw `hgetall` reply, `[field, value, ...]`. Null for a missing key (an empty reply). */
function hashOf(reply: unknown): Record<string, unknown> | null {
  if (!Array.isArray(reply) || reply.length === 0) return null;
  const hash: Record<string, unknown> = {};
  for (let i = 0; i + 1 < reply.length; i += 2) hash[String(reply[i])] = reply[i + 1];
  return hash;
}

/** Why a group could not be served: no data cached, or the read threw. */
export type GroupFailure = "unavailable" | "error";

/** Body of GET /api/pools. A group is in exactly one of `groups` and `failed`. */
export type PoolsResponse = {
  groups: Partial<Record<Group, GroupedResponse>>;
  failed: Partial<Record<Group, GroupFailure>>;
};

// Groups already reported as having no cached data in this instance. A group stays unavailable until its
// cron succeeds, so it is logged once per instance rather than on every request.
const reportedUnavailable = new Set<Group>();

/**
 * Reads every group the registry fetches in one pipelined request (one round trip; Upstash still bills
 * each command). Errors are kept per command, so a group whose key failed is marked `"error"` and the
 * others still load. When the request as a whole fails, every group is an `"error"`.
 */
export async function readAllGrouped(groups: readonly Group[] = fetchedGroups()): Promise<PoolsResponse> {
  const body: PoolsResponse = { groups: {}, failed: {} };
  if (groups.length === 0) return body;

  const keys = groups.map(keysOf);
  const pipeline = getPoolsReadRedis().pipeline();
  for (const key of keys.flat()) pipeline.hgetall(key);

  let replies: { result?: unknown; error?: string }[];
  try {
    replies = await pipeline.exec({ keepErrors: true });
  } catch (err) {
    console.error("Pool data read failed", err);
    for (const group of groups) body.failed[group] = "error";
    return body;
  }

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
    );
    if (response === null) {
      if (!reportedUnavailable.has(group)) {
        reportedUnavailable.add(group);
        console.warn(`No cached pool data for ${group}`);
      }
      body.failed[group] = "unavailable";
    } else {
      reportedUnavailable.delete(group);
      body.groups[group] = response;
    }
  });
  return body;
}
