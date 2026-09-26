// helpers/fetchGroupedSubgraph.ts

import { PoolMetrics, SubgraphGroup, SubgraphMeta } from "@/types/PoolMetrics";

export type GroupedPool = {
  id: string;
  pool: any;
  poolSnapshots: any[];
  threeMonthLiquidityData: any[];
  swaps?: any[];
  metrics?: PoolMetrics;
};

// The legacy backend returns the bare array; v2 wraps it with freshness fields.
type ApiResponse =
  | GroupedPool[]
  | (Partial<SubgraphMeta> & { data?: GroupedPool[] | null; parts?: unknown });

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
export async function fetchGroupedSubgraph(protocol: SubgraphGroup): Promise<GroupedSubgraphData> {
  const res = await fetch(`/api/backend/subgraphs/${protocol}-grouped`, { method: "GET" });

  if (!res.ok) {
    throw new Error(`Error fetching ${protocol} grouped data (HTTP ${res.status})`);
  }

  const body = (await res.json()) as ApiResponse;

  let list: GroupedPool[];
  let meta: SubgraphMeta;
  if (Array.isArray(body)) {
    list = body;
    meta = { fetchedAt: null, indexedAt: null, hasIndexingErrors: null };
  } else {
    list = Array.isArray(body?.data) ? body.data : [];
    meta = {
      fetchedAt: numberOrNull(body?.fetchedAt),
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
