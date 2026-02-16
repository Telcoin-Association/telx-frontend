// helpers/fetchGroupedSubgraph.ts

type GroupedPool = {
  id: string;
  pool: any;
  poolSnapshots: any[];
  threeMonthLiquidityData: any[];
  quarterYearVolumeData: any[];
};

// what your API returns: array of grouped objects (per pool)
type ApiResponse = GroupedPool[];

const normalizeId = (v?: string) => v?.trim().toLowerCase() ?? "";

/**
 * Fetch grouped subgraph data once, and return an index for O(1) access by poolId.
 */
export async function fetchGroupedSubgraph(poolIds: string[] | null, protocol: string) {
  if (!poolIds) {
    return;
  }
  const ids = Array.from(new Set(poolIds.map(normalizeId))).filter(Boolean);

  if (ids.length === 0) return { byId: {} as Record<string, GroupedPool>, list: [] as GroupedPool[] };

  const params = new URLSearchParams();
  ids.forEach((id) => params.append("poolIds", id));

  let url;

  if (protocol === "balancer") {
    url = `/api/backend/subgraphs/balancer-grouped`
    // url = `/api/balancer-grouped?${params.toString()}`
  }
  else if (protocol === "uniswapBase") {
    url = `/api/backend/subgraphs/uniswap-base-grouped`
    // url = `/api/uniswap-grouped?chain=base&${params.toString()}`
  }
  else if (protocol === "uniswapPolygon") {
    url = `/api/backend/subgraphs/uniswap-polygon-grouped`
    // url = `/api/uniswap-grouped?chain=polygon&${params.toString()}`
  }
  else if (protocol === "quickswap") {
    url = `/api/backend/subgraphs/quickswap-grouped`
    //   url = "/api/quickswap-grouped?"
  }
  else {
    url = ""
  }

  const res = await fetch(url.toString(), {
    method: "GET",
  });

  if (!res.ok) {
    throw new Error(`Error fetching ${protocol} grouped data. poolIds: ${ids.join(",")}`);
  }

  const list = (await res.json()) as ApiResponse;

  // Build O(1) lookup map by pool id
  const byId = list.reduce<Record<string, GroupedPool>>((acc, item) => {
    const key = item.id ? normalizeId(item.id) : normalizeId(item.pool.id);
    acc[key] = item;
    return acc;
  }, {});

  return { byId, list };
}
