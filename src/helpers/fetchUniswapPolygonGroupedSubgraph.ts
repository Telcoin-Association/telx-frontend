// helpers/fetchQuickswapGroupedSubgraph.ts

type GroupedPool = {
  id: string;
  pool: any;
  poolSnapshots: any[];
  quarterYearLiquidityData: any[];
  quarterYearVolumeData: any[];
};

// what your API returns: array of grouped objects (per pool)
type ApiResponse = GroupedPool[];

const normalizeId = (v?: string) => v?.trim().toLowerCase() ?? "";

/**
 * Fetch grouped quickswap subgraph data once, and return an index for O(1) access by poolId.
 */
export async function fetchUniswapPolygonGroupedSubgraph(poolIds: string[]) {
  const ids = Array.from(new Set(poolIds.map(normalizeId))).filter(Boolean);

  if (ids.length === 0) return { byId: {} as Record<string, GroupedPool>, list: [] as GroupedPool[] };

  const params = new URLSearchParams();
  ids.forEach((id) => params.append("poolIds", id));

  const res = await fetch(`/api/uniswap-polygon-grouped?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Error fetching uniswap grouped data. poolIds: ${ids.join(",")}`);
  }

  const list = (await res.json()) as ApiResponse;
  // Build O(1) lookup map by pool id
  const byIdPolygon = list.reduce<Record<string, GroupedPool>>((acc, item) => {
    const key = normalizeId(item.pool.id);
    acc[key] = item;
    return acc;
  }, {});

  return { byIdPolygon, list };
}
