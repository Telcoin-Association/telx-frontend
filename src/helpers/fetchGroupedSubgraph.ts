import { PoolMetrics, SubgraphGroup, SubgraphMeta } from "@/types/PoolMetrics";

export type GroupedPool = {
  id: string;
  pool: any;
  poolSnapshots: any[];
  threeMonthLiquidityData: any[];
  swaps?: any[];
  /**
   * undefined on a legacy payload young enough for readers to compute locally; null when the
   * values are unknown (a v2 payload whose hourly part is missing, or legacy rows too old to trust).
   */
  metrics?: PoolMetrics | null;
};

/**
 * A payload with `parts.legacy: true` carries rows from a frozen entry, and its top-level `fetchedAt`
 * is the age of the rows the readers would sum. Past this age a local 24h figure describes a window
 * that no longer matches the clock. /api/pools sends `legacy: false`; the rule applies to any payload
 * that sets it.
 */
export const LEGACY_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

// Older payloads are a bare array or { fetchedAt, data }; v2 adds indexedAt, hasIndexingErrors and parts.
type ApiResponse =
  | GroupedPool[]
  | (Partial<SubgraphMeta> & { data?: GroupedPool[] | null; parts?: { legacy?: boolean } | null });

export type GroupedSubgraphData = {
  byId: Record<string, GroupedPool>;
  list: GroupedPool[];
  meta: SubgraphMeta;
};

const normalizeId = (v?: string) => v?.trim().toLowerCase() ?? "";

const numberOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parses one group's payload into an index by pool id plus the payload's freshness. */
export function parseGroupedBody(body: ApiResponse): GroupedSubgraphData {
  let list: GroupedPool[];
  let meta: SubgraphMeta;
  if (Array.isArray(body)) {
    list = body;
    meta = { fetchedAt: null, indexedAt: null, hasIndexingErrors: null };
  } else {
    list = Array.isArray(body?.data) ? body.data : [];
    const fetchedAt = numberOrNull(body?.fetchedAt);
    const legacy = body?.parts?.legacy;
    const legacyRowsTrusted =
      legacy === true && fetchedAt !== null && Date.now() - fetchedAt < LEGACY_FALLBACK_MAX_AGE_MS;
    if (legacy === false || (legacy === true && !legacyRowsTrusted)) {
      list = list.map((item) => (item.metrics === undefined ? { ...item, metrics: null } : item));
    }
    meta = {
      fetchedAt,
      indexedAt: numberOrNull(body?.indexedAt),
      hasIndexingErrors: typeof body?.hasIndexingErrors === "boolean" ? body.hasIndexingErrors : null,
    };
  }

  // Build O(1) lookup map by pool id
  const byId = list.reduce<Record<string, GroupedPool>>((acc, item) => {
    const key = item.id ? normalizeId(item.id) : normalizeId(item.pool?.id);
    if (key) acc[key] = item;
    return acc;
  }, {});

  return { byId, list, meta };
}

/** Body of GET /api/pools: the groups that loaded, and the ones that did not with the reason. */
type PoolsApiResponse = {
  groups?: Partial<Record<SubgraphGroup, ApiResponse>> | null;
  failed?: Partial<Record<SubgraphGroup, string>> | null;
};

/**
 * A group /api/pools reported as `"unavailable"`: the server has no data for it within its age limit.
 * Unlike a failed read or request, this is the server's answer about the data itself.
 */
export class GroupUnavailableError extends Error {
  constructor(group: SubgraphGroup) {
    super(`Error fetching ${group} grouped data (unavailable)`);
    this.name = "GroupUnavailableError";
  }
}

/** Per requested group, its data or the error that kept it from loading. */
export type GroupedSubgraphResults = Partial<Record<SubgraphGroup, GroupedSubgraphData | Error>>;

/**
 * Fetch the grouped pool data for `groups` with one request to /api/pools, which serves every group.
 * Each requested group comes back as its data, or as an Error when the route marked it as failed, left
 * it out, or the request itself failed. A group the route marked `"unavailable"` is a `GroupUnavailableError`.
 */
export async function fetchGroupedSubgraphs(groups: readonly SubgraphGroup[]): Promise<GroupedSubgraphResults> {
  const results: GroupedSubgraphResults = {};
  if (groups.length === 0) return results;

  let body: PoolsApiResponse;
  try {
    const res = await fetch("/api/pools", { method: "GET" });
    if (!res.ok) throw new Error(`Error fetching pool data (HTTP ${res.status})`);
    body = (await res.json()) as PoolsApiResponse;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    for (const group of groups) results[group] = error;
    return results;
  }

  for (const group of groups) {
    const failure = body?.failed?.[group];
    const data = body?.groups?.[group];
    if (failure === "unavailable") {
      results[group] = new GroupUnavailableError(group);
    } else if (failure || !data) {
      results[group] = new Error(`Error fetching ${group} grouped data (${failure ?? "missing"})`);
    } else {
      results[group] = parseGroupedBody(data);
    }
  }
  return results;
}
