// helpers/fetchGroupedSubgraph.ts

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
 * The backend reports `parts.legacy: true` when any part comes from its frozen `:v1` entry. The
 * top-level `fetchedAt` then belongs to that entry, so its age is the age of the rows the readers
 * would sum. Past this age a local 24h figure describes a window that no longer matches the clock.
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

/**
 * Fetch one protocol's grouped subgraph data (the backend serves every pool of the group)
 * and return an index for O(1) access by pool id, plus the response's freshness.
 */
export async function fetchGroupedSubgraph(group: SubgraphGroup): Promise<GroupedSubgraphData> {
  const res = await fetch(`/api/backend/subgraphs/${group}-grouped`, { method: "GET" });

  if (!res.ok) {
    throw new Error(`Error fetching ${group} grouped data (HTTP ${res.status})`);
  }

  const body = (await res.json()) as ApiResponse;

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
