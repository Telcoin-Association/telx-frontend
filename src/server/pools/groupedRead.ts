import "server-only";

import { dailyKey, hourlyKey, mergeGroupedParts, quickswapKey, readSnapshot, singlePartResponse, type GroupedResponse } from "./cache";
import { fetchedGroups, type Group } from "./registry";

/**
 * The cached data for one group. Split groups merge their hourly and daily keys; one part alone is
 * served as it is (the two crons run on different schedules, so one part can briefly be missing).
 * Null when the group has no data at all.
 */
export async function readGrouped(group: Group): Promise<GroupedResponse | null> {
  if (group === "quickswap") {
    const snapshot = await readSnapshot(quickswapKey);
    return snapshot && singlePartResponse(snapshot);
  }
  const [hourly, daily] = await Promise.all([readSnapshot(hourlyKey(group)), readSnapshot(dailyKey(group))]);
  return mergeGroupedParts(hourly, daily);
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

/** Reads every group the registry fetches. A failed group is marked in `failed`; the others still load. */
export async function readAllGrouped(groups: readonly Group[] = fetchedGroups()): Promise<PoolsResponse> {
  const settled = await Promise.allSettled(groups.map(group => readGrouped(group)));

  const body: PoolsResponse = { groups: {}, failed: {} };
  settled.forEach((result, i) => {
    const group = groups[i];
    if (result.status === "rejected") {
      console.error(`Pool data read failed for ${group}`, result.reason);
      body.failed[group] = "error";
    } else if (result.value === null) {
      if (!reportedUnavailable.has(group)) {
        reportedUnavailable.add(group);
        console.warn(`No cached pool data for ${group}`);
      }
      body.failed[group] = "unavailable";
    } else {
      reportedUnavailable.delete(group);
      body.groups[group] = result.value;
    }
  });
  return body;
}
