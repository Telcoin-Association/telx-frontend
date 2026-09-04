# api.telx.network Integration (TELx Frontend)

This document explains how the frontend talks to the TELx backend APIs at `https://api.telx.network` and how the responses are transformed (normalized) into the internal data structures used by the UI.

## What calls `api.telx.network`?

In this repository, all direct calls to `api.telx.network` are done by Next.js API route handlers under:

- `src/app/api/backend/subgraphs/*/route.ts`
- `src/app/api/backend/subgraphs/dfx/route.ts`

The frontend never calls `api.telx.network` directly. Instead, it calls internal routes like:

- `/api/backend/subgraphs/uniswap-base-grouped`
- `/api/backend/subgraphs/quickswap-grouped`
- `/api/backend/subgraphs/uniswap-polygon-grouped`
- `/api/backend/subgraphs/balancer-grouped`
- `/api/backend/subgraphs/dfx?poolAddress=0x...`

Those internal routes proxy to `api.telx.network` and return the JSON payload to the frontend.

## Authentication

All proxy route handlers include a bearer token header:

- `Authorization: Bearer ${process.env.TELX_BACKEND_SECRET_KEY}`

So you must set `TELX_BACKEND_SECRET_KEY` in your environment (`.env.local`).

## TELx API Endpoints We Call

### Grouped “active pools” endpoints (used for charting + liquidity/volume inputs)

The following endpoints are called by the internal “grouped” routes:

1. `GET https://api.telx.network/api/v1/active/get/uniswap-base-grouped`
2. `GET https://api.telx.network/api/v1/active/get/uniswap-polygon-grouped`
3. `GET https://api.telx.network/api/v1/active/get/quickswap-grouped`
4. `GET https://api.telx.network/api/v1/active/get/balancer-grouped`

Corresponding internal Next.js proxy routes:

- `src/app/api/backend/subgraphs/uniswap-base-grouped/route.ts` → `/api/backend/subgraphs/uniswap-base-grouped`
- `src/app/api/backend/subgraphs/uniswap-polygon-grouped/route.ts` → `/api/backend/subgraphs/uniswap-polygon-grouped`
- `src/app/api/backend/subgraphs/quickswap-grouped/route.ts` → `/api/backend/subgraphs/quickswap-grouped`
- `src/app/api/backend/subgraphs/balancer-grouped/route.ts` → `/api/backend/subgraphs/balancer-grouped`

### DFX endpoint (used for DFX pool reserve/volume + chart inputs)

1. `GET https://api.telx.network/api/v1/get/dfx/${poolAddress}`

Corresponding internal route:

- `src/app/api/backend/subgraphs/dfx/route.ts` → `/api/backend/subgraphs/dfx?poolAddress=0x...`

## Response Wrapping Expectation

For the “grouped” endpoints, each proxy route does:

- `const data = await r.json();`
- `return NextResponse.json(data.data);`

So, the TELx API response is expected to look like:

```json
{ "data": <payload> }
```

and the internal proxy returns just `<payload>`.

The grouped payload is expected to be an array of “grouped pool objects”.

For the DFX endpoint, the internal proxy returns `JSON.stringify(data)` directly (no `data.data` unwrapping in `dfx/route.ts`), so the frontend expects the TELx response shape as-is.

## End-to-End Flow (UI → Redux → grouped fetch → normalization → UI state)

### 1) Contract list is loaded + normalized

The pool/mining-contract configuration comes from `src/data/pool.json`.

When the app starts (or wallet changes), it:

1. dispatches `initializeList(pools)` in `src/components/layout/AppLayout.tsx`
2. reducers in `src/redux/slices/contractsSlice.ts` call:
   - `normalizeMiningContracts(...)` from `src/helpers/normalizeMiningContracts.ts`

This creates the internal “mining contract” objects used everywhere else in the app.

### 2) Fetch all per-contract computed data (liquidity/volume/stake/rewards)

`src/redux/slices/contractsSlice.ts` dispatches `fetchAllContractData(address)` which calls:

- `getAllContractData(list, selectedWalletAddress)` in `src/web3/getContracts/shared.ts`

Inside `getAllContractData`:

1. It prefetches grouped subgraph data (for protocols that require it) via:
   - `prefetchGroupedSubgraph(CONTRACTS_DATA)` in `src/helpers/prefetchGroupedSubgraph.ts`
2. Then for each contract it calls a protocol-specific `*GetSingleContractData(...)`.

### 3) Grouped-prefetch (single fetch per protocol, cached, O(1) lookup by pool id)

The prefetch logic:

- determines which contracts need subgraph data via flags on the normalized contract:
  - `protocol`
  - `blockchain`
  - `fetchSubgraph`
  - `subgraphId` (Balancer)
- computes pool id lists
- fetches grouped endpoints in parallel
- reduces results into `byId` lookup maps for O(1) access.

Relevant code:

- `src/helpers/prefetchGroupedSubgraph.ts`
- calls `src/helpers/fetchGroupedSubgraph.ts`

### 4) Protocol-specific interpretation of grouped payload

Each protocol’s `*GetSingleContractData` consumes the grouped data as inputs to compute:

- `totalLiquidity`
- `dailyVolumeUSD`
- `fees24hr`
- chart datasets (`liquidityChartData`, `volumeChartData`, etc.)
- user stake values (computed from on-chain balances + the liquidity inputs)

Those computed objects are returned and stored in Redux (`contractsSlice`).

## Normalization / Data Transformation Functions Used

This section lists every helper/function in the repo that transforms data returned from the TELx APIs (and the derived “normalized” structures the app relies on).

### `normalizeMiningContract` / `normalizeMiningContracts`

File: `src/helpers/normalizeMiningContracts.ts`

Purpose:

Normalize the mining-contract configuration (from `pool.json`) into the shape the app expects.

Key transformations:

- Rewards tokens:
  - splits `reward.attributes.name` (expects format like `"TEL 123"` or `"TOKEN 0.5"`)
  - converts token amounts into numbers:
    - `amount: Number(reward.attributes.name.split(" ")[1])`
    - `ticker: reward.attributes.name.split(" ")[0]`
- Assets:
  - parses each `pool_assets.data[*].attributes.name` into `{ ticker, weight }`
- Stake addresses:
  - selects the active staking address from `stake_addresses.data` (`attributes.active === true`)
  - collects deprecated staking addresses where `active === false`

Output fields include:

- `pool`, `protocol`, `blockchain`
- `rewards` (type + tokens + interval)
- `assets`
- `links`
- `activeStakingAddress` (or undefined)
- `deprecatedStakingAddresses`
- `fetchSubgraph` (boolean)
- `subgraphId` (Balancer)

Note: This normalization is not transforming TELx API responses directly; it normalizes the local config that decides how TELx grouped APIs are used.

### `fetchGroupedSubgraph(poolIds, protocol)`

File: `src/helpers/fetchGroupedSubgraph.ts`

Purpose:

Fetch grouped pools once per protocol from internal proxy routes, and normalize the result into:

- `{ list, byId }`
- where `byId` is keyed by a normalized pool id string for O(1) lookup.

How it normalizes IDs:

```ts
const normalizeId = (v?: string) => v?.trim().toLowerCase() ?? "";
```

It then reduces the API response array into a lookup map:

```ts
const key = item.id ? normalizeId(item.id) : normalizeId(item.pool.id);
acc[key] = item;
```

Important implementation note (developer-visible behavior):

`fetchGroupedSubgraph` creates `params` with `poolIds`, but it never attaches those params to the fetch URL.

So in practice, the internal grouped endpoint is called without any query filtering, and the client still selects the specific pools via the `byId` map.

If the backend/proxy endpoints start returning smaller subsets in the future, you may need to fix this by appending the query string.

### `prefetchGroupedSubgraph(contracts, ttlMs?)`

File: `src/helpers/prefetchGroupedSubgraph.ts`

Purpose:

1. Decide which contracts need grouped subgraph data.
2. Fetch grouped datasets in parallel.
3. Cache results in-memory for a short TTL (module-level cache).
4. Return the `byId` maps needed by each protocol.

Normalization/caching details:

- Uses `buildKey(contracts)` to build a stable cache key from:
  - `protocol`
  - `blockchain`
  - `pool` (normalized via `norm(...)` which is trim+lowercase)
- Maintains a module-level cache plus an `inflight` map to avoid duplicate concurrent fetches.

It returns:

- `quickswapById`
- `uniswapById`
- `balancerById`

Uniswap grouped results:

- base and polygon grouped responses are merged:
  - `uniswapById = { ...baseById, ...polygonById }`

### Protocol-specific “normalization” of grouped payload fields into UI-ready values

These functions do not change the payload shape (like `byId` indexing), but they interpret and convert the grouped payload fields into the standardized internal contract data used by the rest of the app.

#### Quickswap

File: `src/web3/getContracts/quickswap/getSingleContractData.ts`

Expected grouped payload keys used:

- `subgraphInfo.pool.reserveUSD` → `totalLiquidity`
- `subgraphInfo.poolSnapshots[0].dailyVolumeUSD` → `dailyVolumeUSD`
- `subgraphInfo.threeMonthLiquidityData` → chart data

Then `quickswapGetStakeInfo(...)` uses `totalLiquidity` (derived above) as an input to compute:

- staked USD (`stakedUSD`)
- reward allocation estimation (`weeklyUser`)

#### Uniswap (Uniswap v4 staking/rewards calculations)

File: `src/web3/getContracts/uniswapv4/getSingleContractData.ts`

Expected grouped payload keys used:

- `subgraphInfo.pool.totalValueLockedUSD` → `totalLiquidity`
- `subgraphInfo.poolSnapshots[*]`:
  - `periodStartUnix`
  - `volumeUSD`
  - `feesUSD`
- `subgraphInfo.weeklyVolume` → chart data (`volumeChartData`, `feeChartData`)
- `subgraphInfo.threeMonthLiquidityData[*]`:
  - `date`
  - `swapVolume`
  - `swapFees`

Transformations performed:

- “dailyVolumeUSD” and “fees24hr” are computed by summing only the snapshots from the last 24 hours.
- “24h fee” fields are aggregated as:
  - `fees24hr += snapshot.feesUSD`
- The three-month series is converted into incremental (delta) swap volumes/fees by subtracting the previous point.

#### Balancer

File: `src/web3/getContracts/balancer/getSingleContractData.ts`

Expected grouped payload keys used:

- `subgraphInfo.poolSnapshots[*]`:
  - `swapVolume`
  - `swapFees`
- `subgraphInfo.threeMonthLiquidityData[*]`:
  - `date`
  - `swapVolume`
  - `swapFees`

Transformations performed:

- `dailyVolumeUSD` and `fees24hr` are derived using the difference between the last two snapshots:
  - if exactly 1 snapshot: use snapshot directly
  - else: compute snapshot[1] - snapshot[0]
- The three-month series is converted to deltas (subtract previous point).
- `totalLiquidity` for Balancer is computed using:
  - `getPoolLiquidityValue(...)` which reads pool token balances from the Balancer Vault and multiplies by token prices
  - This is a derived computation; grouped payload provides the swap/volume series and chart inputs.

File: `src/web3/getContracts/balancer/vault.ts`

#### DFX

There are two data sources for DFX subgraph info:

1. Preferred: cached TELx API via the backend proxy:
   - `/api/backend/subgraphs/dfx?poolAddress=...`
   - which calls `https://api.telx.network/api/v1/get/dfx/${poolAddress}`
2. Fallback: direct GraphQL query to the DFX subgraph (via Apollo)
   - `dfxGetSubgraphInfo(poolAddress)` in `src/web3/getContracts/dfx/getSubgraphInfo.ts`

File: `src/web3/getContracts/dfx/getSingleContractData.ts`

Expected keys used after fetching:

- `subgraphInfo.data.pair.reserveUSD` → `totalLiquidity`
- `subgraphInfo.data.pairDayData.volumeUSD` → `dailyVolumeUSD`
- `subgraphInfo.data.quarterYearLiquidityData` → liquidity chart
- `subgraphInfo.data.quarterYearVolumeData` → volume chart

Notes for developers:

- The codepath that reads the TELx cached endpoint expects the backend response to include `redisData.data`.
- The fallback GraphQL query yields an Apollo result (`subgraphInfo.data` exists).

## Where the Final Normalized Data Goes

After each `*GetSingleContractData` returns:

1. Redux `contractsSlice` iterates the resulting list.
2. It stores:
   - `state.contracts` keyed by `contract.poolContractAddress`
   - aggregated totals (liquidity, volume, fees)
   - optional user-specific subsets:
     - `state.userContracts`

So the final normalized output you interact with in components is stored in:

- `contractsSlice` state fields (`state.contracts.contracts`, `state.contracts.userContracts`, etc.)

## Files to Consult (quick index)

- Proxy routes:
  - `src/app/api/backend/subgraphs/uniswap-base-grouped/route.ts`
  - `src/app/api/backend/subgraphs/uniswap-polygon-grouped/route.ts`
  - `src/app/api/backend/subgraphs/quickswap-grouped/route.ts`
  - `src/app/api/backend/subgraphs/balancer-grouped/route.ts`
  - `src/app/api/backend/subgraphs/dfx/route.ts`
- Grouped fetching + normalization:
  - `src/helpers/fetchGroupedSubgraph.ts`
  - `src/helpers/prefetchGroupedSubgraph.ts`
- Mining-contract normalization:
  - `src/helpers/normalizeMiningContracts.ts`
- Protocol consumption:
  - `src/web3/getContracts/quickswap/getSingleContractData.ts`
  - `src/web3/getContracts/uniswapv4/getSingleContractData.ts`
  - `src/web3/getContracts/balancer/getSingleContractData.ts`
  - `src/web3/getContracts/dfx/getSingleContractData.ts`

## Open Questions / Potential Improvements

1. **Grouped `poolIds` filtering is currently not applied client-side.**
   `fetchGroupedSubgraph` builds `poolIds` query params but does not attach them to the `fetch(...)` URL.
2. **DFX response shape assumption.**
   The code expects `{ redisData: { data: ... } }` from the cached backend path; the precise structure returned by `api.telx.network/api/v1/get/dfx/:poolAddress` should be confirmed.

## Appendix: Copy/paste Reference Code (TELx integration flow)

The blocks below contain the full source for the functions/modules used to:

1. Proxy requests from the Next.js app to `api.telx.network`
2. Normalize grouped-subgraph payloads (protocol-specific interpretation + `byId` lookup)
3. Orchestrate the full “contracts list -> grouped fetch -> per-protocol mapping -> Redux storage”

Note: Some of these functions depend on other repo modules/constants (e.g. `provider`, ABIs, token metadata). Those are marked in the text above each block.

### Proxy routes to `api.telx.network`

#### `src/app/api/backend/subgraphs/uniswap-polygon-grouped/route.ts`
```ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {

  const backendUrl = new URL(
    "https://api.telx.network/api/v1/active/get/uniswap-polygon-grouped"
    // "http://localhost:3001/api/v1/active/get/uniswap-polygon-grouped"
  );
  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;

  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  const r = await fetch(
    backendUrl,
    { headers }
  );
  
  if (!r.ok) {
    const text = await r.text();
    return NextResponse.json(
      { error: "Backend request failed", status: r.status, body: text },
      { status: r.status }
    );
  }

  const data = await r.json();

  return NextResponse.json(data.data);
}
```

#### `src/app/api/backend/subgraphs/uniswap-base-grouped/route.ts`
```ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {

  const backendUrl = new URL(
    "https://api.telx.network/api/v1/active/get/uniswap-base-grouped"
    // "http://localhost:3001/api/v1/active/get/uniswap-base-grouped"
  );
  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;

  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  const r = await fetch(
    backendUrl,
    { headers }
  );
  
  if (!r.ok) {
    const text = await r.text();
    return NextResponse.json(
      { error: "Backend request failed", status: r.status, body: text },
      { status: r.status }
    );
  }

  const data = await r.json();

  return NextResponse.json(data.data);
}
```

#### `src/app/api/backend/subgraphs/quickswap-grouped/route.ts`
```ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {

  const backendUrl = new URL(
    "https://api.telx.network/api/v1/active/get/quickswap-grouped"
    // "http://localhost:3001/api/v1/active/get/quickswap-grouped"
  );
  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;

  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  const r = await fetch(
    backendUrl,
    { headers }
  );
  
  if (!r.ok) {
    const text = await r.text();
    return NextResponse.json(
      { error: "Backend request failed", status: r.status, body: text },
      { status: r.status }
    );
  }

  const data = await r.json();

  return NextResponse.json(data.data);
}
```

#### `src/app/api/backend/subgraphs/balancer-grouped/route.ts`
```ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {

  const backendUrl = new URL(
    "https://api.telx.network/api/v1/active/get/balancer-grouped"
    // "http://localhost:3001/api/v1/active/get/balancer-grouped"
  );
  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;

  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  const r = await fetch(
    backendUrl,
    { headers }
  );

  if (!r.ok) {
    const text = await r.text();
    return NextResponse.json(
      { error: "Backend request failed", status: r.status, body: text },
      { status: r.status }
    );
  }

  const data = await r.json();

  return NextResponse.json(data.data);
}
```

#### `src/app/api/backend/subgraphs/dfx/route.ts`
```ts
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolAddress = searchParams.get("poolAddress");

  if (!poolAddress) {
    return new Response(
      JSON.stringify({
        error: "DFX: Pool address is required. Refer: api/backend/subgraphs/dfx.ts",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const secretKey = process.env.TELX_BACKEND_SECRET_KEY;
  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  try {
    const response = await fetch(
      `https://api.telx.network/api/v1/get/dfx/${poolAddress}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch data: /api/backend/subgraphs/dfx. Pool: ${poolAddress}`
      );
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
```

### Grouped fetch + normalization helpers

#### `src/helpers/fetchGroupedSubgraph.ts`
```ts
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
  }
  else if (protocol === "uniswapBase") {
    url = `/api/backend/subgraphs/uniswap-base-grouped`
  }
  else if (protocol === "uniswapPolygon") {
    url = `/api/backend/subgraphs/uniswap-polygon-grouped`
  }
  else if (protocol === "quickswap") {
    url = `/api/backend/subgraphs/quickswap-grouped`
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
```

#### `src/helpers/prefetchGroupedSubgraph.ts`
```ts
import { fetchGroupedSubgraph } from "./fetchGroupedSubgraph";
import { miningContract } from "./normalizeMiningContracts";

type ById = any | undefined;

const norm = (v?: string) => v?.trim().toLowerCase() ?? "";

type GroupedSubgraphResult = {
  quickswapById: ById;
  uniswapById: ById;
  balancerById: ById;
};

// module-level cache (persists while tab is alive)
let cache:
  | {
    key: string;
    quickswapById: ById;
    uniswapById: ById;
    balancerById: ById;
    ts: number;
  }
  | null = null;

// track inflight requests by key
const inflight = new Map<string, Promise<GroupedSubgraphResult>>();

const DEFAULT_TTL_MS = 60 * 1000; // 1 min (tweak)

function buildKey(contracts: miningContract[]) {
  // Cache key based on pools list (stable)
  const pools = contracts
    .map((c) => `${c.protocol}:${c.blockchain ?? ""}:${norm(c.pool)}`)
    .sort()
    .join("|");
  return pools;
}

export async function prefetchGroupedSubgraph(
  contracts: miningContract[],
  ttlMs: number = DEFAULT_TTL_MS
) {
  const key = buildKey(contracts);
  const now = Date.now();

  // return cached if still fresh
  if (cache && cache.key === key && now - cache.ts < ttlMs) {
    return { quickswapById: cache.quickswapById, uniswapById: cache.uniswapById, balancerById: cache.balancerById };
  }

  if (inflight.has(key)) {
    return inflight.get(key)!;
  }

  const hasQuickswap = contracts.some((c) => c.protocol === "quickswap" && c.fetchSubgraph);
  const hasUniswapBase = contracts.some((c) => c.protocol === "uniswap" && c.blockchain === "base" && c.fetchSubgraph);
  const hasUniswapPolygon = contracts.some((c) => c.protocol === "uniswap" && c.blockchain === "polygon" && c.fetchSubgraph);
  const hasBalancer = contracts.some((c) => c.protocol === "balancer" && c.fetchSubgraph);

  const quickswapPoolIds = hasQuickswap
    ? contracts.filter((c) => c.protocol === "quickswap" && c.fetchSubgraph).map((c) => c.pool)
    : [];

  const uniswapBasePoolIds = hasUniswapBase
    ? contracts.filter((c) => c.protocol === "uniswap" && c.blockchain === "base").map((c) => c.pool)
    : [];

  const uniswapPolygonPoolIds = hasUniswapPolygon
    ? contracts.filter((c) => c.protocol === "uniswap" && c.blockchain === "polygon").map((c) => c.pool)
    : [];

  const balancerPoolIds = hasBalancer
    ? contracts.filter((c) => c.protocol === "balancer" && c.subgraphId && c.fetchSubgraph).map((c) => c.subgraphId)
    : [];

  // Fetch in parallel (faster)
  const [quickswapRes, uniswapBaseRes, uniswapPolygonRes, balancerRes] = await Promise.allSettled([
    quickswapPoolIds.length ? fetchGroupedSubgraph(quickswapPoolIds, "quickswap") : Promise.resolve({ byId: {} }),
    uniswapBasePoolIds.length ? fetchGroupedSubgraph(uniswapBasePoolIds, "uniswapBase") : Promise.resolve({ byId: {} }),
    uniswapPolygonPoolIds.length ? fetchGroupedSubgraph(uniswapPolygonPoolIds, "uniswapPolygon") : Promise.resolve({ byId: {} }),
    balancerPoolIds.length ? fetchGroupedSubgraph(balancerPoolIds as any, "balancer") : Promise.resolve({ byId: {} }),
  ]);

  const quickswapById: ById = quickswapRes.status === "fulfilled" ? quickswapRes.value && quickswapRes.value.byId : {};
  const baseById: ById = uniswapBaseRes.status === "fulfilled" ? uniswapBaseRes.value && uniswapBaseRes.value.byId : {};
  const polygonById: ById = uniswapPolygonRes.status === "fulfilled" ? uniswapPolygonRes.value && uniswapPolygonRes.value.byId : {};
  const balancerById: ById = balancerRes.status === "fulfilled" ? balancerRes.value && balancerRes.value.byId : {};

  const uniswapById: ById = { ...baseById, ...polygonById };

  cache = { key, quickswapById, uniswapById, balancerById, ts: now };

  return { quickswapById, uniswapById, balancerById };
}
```

### Mining-contract normalization

#### `src/helpers/normalizeMiningContracts.ts`
```ts
export interface miningContractFields {
  id: number;
  attributes: {
    name: string;
    protocol: string | null;
    protocol_version?: string | null;
    network: string;
    pool_address: string;
    subgraph_id: string | null;
    rewards_type: string;
    rewards_interval: string | null;
    link_add_liquidity: string;
    link_pool_analytics: string | null;
    link_block_explorer: string;
    staking_period: string | null;
    notice: string | null;
    active: boolean;
    fetchSubgraph: boolean;
    blockchain: string;
    rewards_tokens: {
      data: Array<{
        id: number;
        attributes: {
          name: string;
        };
      }>;
    };
    stake_addresses: {
      data: Array<{
        id: number;
        attributes: {
          address: string;
          start_date: string;
          end_date: string | null;
          active: boolean;
          pool: string;
        };
      }>;
    };
    pool_assets: {
      data: Array<{
        id: number;
        attributes: {
          name: string;
        };
      }>;
    };
    decimals?: {
      amount0Decimals: number,
      amount1Decimals: number
    }
  };
}

export const normalizeMiningContract = (data: miningContractFields) => {
  if (!data || !data.attributes) {
    throw new Error("Data is missing required attributes property");
  }
  const attributes = data.attributes;

  const {
    name,
    protocol,
    pool_address,
    subgraph_id,
    rewards_type,
    rewards_interval,
    link_add_liquidity,
    link_pool_analytics,
    link_block_explorer,
    staking_period,
    rewards_tokens,
    stake_addresses,
    pool_assets,
    active,
    fetchSubgraph,
    blockchain,
    decimals,
    protocol_version
  } = attributes;

  const rewards = {
    type: rewards_type,
    tokens: rewards_tokens.data.map(reward => ({
      amount: Number(reward.attributes.name.split(" ")[1]),
      ticker: reward.attributes.name.split(" ")[0],
    })),
    rewardsInterval: rewards_interval,
  };

  const assets = pool_assets.data.map(asset => ({
    ticker: asset.attributes.name.split(" ")[0],
    weight: Number(asset.attributes.name.split(" ")[1]),
  }));

  const links = {
    addLiquidity: link_add_liquidity,
    blockExplorer: link_block_explorer,
    poolAnalytics: link_pool_analytics,
  };

  const activeStakingAddress = stake_addresses?.data?.find(stake => stake.attributes.active);

  const deprecatedStakingAddresses = stake_addresses?.data?.filter(stake => !stake.attributes.active);

  return {
    activeStakingAddress: activeStakingAddress ? activeStakingAddress.attributes : undefined,
    deprecatedStakingAddresses: deprecatedStakingAddresses?.map(stake => stake.attributes),
    rewards: rewards,
    assets: assets,
    links: links,
    stakingPeriod: staking_period,
    name: name,
    pool: pool_address,
    protocol: protocol,
    protocolVersion: protocol_version,
    blockchain: blockchain ? blockchain : "",
    subgraphId: subgraph_id,
    vestingPeriod: "",
    vestingPeriodHelpText: "",
    deprecated: !active,
    fetchSubgraph: fetchSubgraph,
    stake: activeStakingAddress,
    stakeAddressNew: "",
    illustration: "",
    rewardsInterval: rewards_interval,
    deprecatedContractPresent: deprecatedStakingAddresses?.length > 0 ? true : false,
    decimals,
  };
};

export type miningContract = ReturnType<typeof normalizeMiningContract>;

export const normalizeMiningContracts = (response: miningContractFields[]): miningContract[] => {
  return response.map(normalizeMiningContract);
};
```

### Redux orchestration (contracts list -> grouped fetch -> protocol mapping -> store)

#### `src/redux/slices/contractsSlice.ts`
```ts
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import BigNumber from "bignumber.js";
import {
  miningContract,
  normalizeMiningContracts,
  miningContractFields,
} from "@/helpers/normalizeMiningContracts";
import {
  ProtocolsContractData,
  getAllContractData,
} from "@/web3/getContracts/shared";
import { RootState } from "@/redux/store";

export const fetchAllContractData = createAsyncThunk(
  "contracts/fetchAllContractData",
  async (selectedAddress: string | undefined, thunkApi) => {
    const {
      contracts: { list },
    } = thunkApi.getState() as RootState;
    const response = await getAllContractData(list, selectedAddress);

    return response;
  }
);

export type ContractList = { [key: string]: ProtocolsContractData };

interface ContractsState {
  contracts: ContractList;
  hasFetchedData: boolean;
  list: miningContract[];
  loading: boolean;
  deprecatedContracts: ContractList;
  deprecatedPools: ContractList;
  totalLiquidityAll: number | null;
  stakedLiquidityAll: number | null;
  totalVolumeAll: number | null;
  totalFeesAll: number | null;
  userContracts: ContractList;
  userUniswapContracts: ContractList;
  value: number;
}

const initialState = {
  contracts: {},
  hasFetchedData: false,
  list: [],
  loading: true,
  deprecatedContracts: {},
  deprecatedPools: {},
  totalLiquidityAll: null,
  stakedLiquidityAll: null,
  totalVolumeAll: null,
  totalFeesAll: null,
  userContracts: {},
  userUniswapContracts: {},
  value: 0,
} as ContractsState;

export const contractsSlice = createSlice({
  name: "contracts",
  initialState,
  reducers: {
    initializeList: (
      state: any,
      action: PayloadAction<miningContractFields[]>
    ) => {
      const returnedMiningContracts = normalizeMiningContracts(
        action.payload
      );
      state.list = returnedMiningContracts;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchAllContractData.pending, (state) => {
      state.loading = true;
    });
    builder.addCase(fetchAllContractData.rejected, (state, action) => {
      state.hasFetchedData = true;
      state.loading = false;
    });
    builder.addCase(fetchAllContractData.fulfilled, (state, action) => {
      const contracts: any = {};
      const deprecatedPools: any = {};
      const deprecatedContracts: any = {};
      const userContracts: any = {};
      const uniswapUserContracts: any = [];
      let totalLiquidityAll = new BigNumber(0);
      let stakedLiquidityAll = new BigNumber(0);
      let totalVolumeAll = new BigNumber(0);
      let totalFeesAll = new BigNumber(0);

      action.payload &&
        action.payload.forEach((contract: any) => {
          if (contract?.poolContractAddress) {
            if (!contract.deprecated) {
              contracts[contract.poolContractAddress] = contract;
              // Create BigNumbers from string representations
              const totalLiquidity = contract.totalLiquidity
                ? new BigNumber(String(contract.totalLiquidity))
                : new BigNumber(0);
              const stakedLiquidity = contract.stakedLiquidity
                ? new BigNumber(String(contract.stakedLiquidity))
                : new BigNumber(0);
              const totalVolume = contract.dailyVolumeUSD
                ? new BigNumber(String(contract.dailyVolumeUSD))
                : new BigNumber(0);
              const totalFees = contract.fees24hr
                ? new BigNumber(String(contract.fees24hr))
                : new BigNumber(0);

              // Handle user.stakedLPT conversion
              if (contract?.user?.stakedLPT) {
                const stakedLPT: any = contract.user.stakedLPT;
                const stakedLPTString =
                  typeof stakedLPT === "bigint"
                    ? stakedLPT.toString()
                    : String(stakedLPT);

                if (new BigNumber(stakedLPTString).isGreaterThan(0)) {
                  userContracts[contract.poolContractAddress] = contract;
                }
              }

              totalLiquidityAll = totalLiquidityAll.plus(totalLiquidity);
              stakedLiquidityAll = stakedLiquidityAll.plus(stakedLiquidity);
              totalVolumeAll = totalVolumeAll.plus(totalVolume);
              totalFeesAll = totalFeesAll.plus(totalFees);

              if (
                contract.deprecatedStakingAddresses &&
                contract.deprecatedStakingAddresses.length > 0 || contract.protocol === "uniswap"
              ) {
                deprecatedContracts[contract.poolContractAddress] = contract;
              }
            } else {
              deprecatedPools[contract.poolContractAddress] = contract;
            }
            if (contract.protocol === "uniswap") {
              uniswapUserContracts.push(contract);
            }
          }
        });

      state.hasFetchedData = true;
      state.contracts = contracts;
      state.deprecatedContracts = deprecatedContracts;
      state.deprecatedPools = deprecatedPools;
      state.totalLiquidityAll = totalLiquidityAll.toNumber();
      state.stakedLiquidityAll = stakedLiquidityAll.toNumber();
      state.totalVolumeAll = totalVolumeAll.toNumber();
      state.totalFeesAll = totalFeesAll.toNumber();
      state.userContracts = userContracts;
      state.userUniswapContracts = uniswapUserContracts;
      state.loading = false;
    });
  },
});

export const { initializeList } = contractsSlice.actions;

export const contractsSelector = (state: RootState) =>
  state.contracts.contracts;
export const contractsLoadingSelector = (state: RootState) =>
  state.contracts.loading;
export const contractsListSelector = (state: RootState) => state.contracts.list;
export const deprecatedContractsListSelector = (state: RootState) =>
  state.contracts.deprecatedContracts;
export const deprecatedPoolsListSelector = (state: RootState) =>
  state.contracts.deprecatedPools;
export const totalLiquiditySelector = (state: RootState) =>
  state.contracts.totalLiquidityAll;
export const stakedLiquiditySelector = (state: RootState) =>
  state.contracts.stakedLiquidityAll;
export const totalVolumeSelector = (state: RootState) =>
  state.contracts.totalVolumeAll;
export const totalFeesSelector = (state: RootState) =>
  state.contracts.totalFeesAll;
export const hasFetchedDataSelector = (state: RootState) =>
  state.contracts.hasFetchedData;
export const userContractsSelector = (state: RootState) =>
  state.contracts.userContracts;
export const userUniswapContractsSelector = (state: RootState) =>
  state.contracts.userUniswapContracts;

export default contractsSlice.reducer;
```

#### `src/web3/getContracts/shared.ts` (main orchestrator)
```ts
import { dfxGetSingleContractData, DfxContractData } from "./dfx/getSingleContractData";
import { quickswapGetSingleContractData, QuickswapContractData } from "./quickswap/getSingleContractData";
import { balancerGetSingleContractData, BalancerContractData } from "./balancer/getSingleContractData";
import { UniswapContractData, uniswapGetSingleContractData } from "./uniswapv4/getSingleContractData";
import { miningContract } from "../../helpers/normalizeMiningContracts";
import { getTokenPricesCached } from "@/helpers/getTokenPricesCached";
import { prefetchGroupedSubgraph } from "@/helpers/prefetchGroupedSubgraph";

export type ProtocolsContractData = BalancerContractData | DfxContractData | QuickswapContractData | UniswapContractData;

export async function getAllContractData(CONTRACTS_DATA: miningContract[], selectedWalletAddress: string | undefined) {
  const contracts: ReturnType<typeof quickswapGetSingleContractData | typeof balancerGetSingleContractData | typeof dfxGetSingleContractData | typeof uniswapGetSingleContractData>[] = [];
  const hasBalancer = CONTRACTS_DATA.some(c => c.protocol === "balancer");
  const tokenPrices = hasBalancer ? await getTokenPricesCached() : undefined;

  const { quickswapById, uniswapById, balancerById } = await prefetchGroupedSubgraph(CONTRACTS_DATA);

  for (let i = 0; i < CONTRACTS_DATA.length; i++) {
    const value = CONTRACTS_DATA[i];
    const poolId = CONTRACTS_DATA[i].pool;
    const poolKey = value.pool?.trim().toLowerCase();

    switch (value.protocol) {
      case "quickswap":
        contracts.push(quickswapGetSingleContractData(value, selectedWalletAddress, quickswapById[poolKey]));
        break;

      case "balancer":
        contracts.push(balancerGetSingleContractData(value, selectedWalletAddress, tokenPrices!, value.subgraphId && balancerById[value.subgraphId]));
        break;

      case "dfx":
        contracts.push(dfxGetSingleContractData(value, selectedWalletAddress));
        break;

      case "uniswap":
        contracts.push(uniswapGetSingleContractData(value, selectedWalletAddress, uniswapById[poolId]));
        break;
    }
  }

  return await Promise.all(contracts);
}
```

### Token pricing & reward token mapping helpers

#### `src/helpers/getTokenPrices.ts`
```ts
import axios from "axios";

export async function getTokenPrices() {
    try {
        const response = await axios.get("/api/market-rate");
        if (response.status === 200 || response.status === 201) {
            const prices = response.data;

            return {
                "0x27f485b62c4a7e635f561a87560adf5090239e93": prices.DFX.USD,
                "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": prices.USDC.USD,
                "0xdf7837de1f2fa4631d716cf2502f8b230f1dcc32": prices.TEL.USD,
                "0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3": prices.BAL.USD,
                "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": prices.WETH.USD,
                "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": prices.WPOL.USD,
                "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6": prices.WBTC.USD,
                "0xd6df932a45c0f255f85145f286ea0b292b21c90b": prices.AAVE.USD,
                "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": prices["USDC.e"].USD,
                "0xe7804d91dfcde7f776c90043e03eaa6df87e6395": 0,
            };
        } else {
            throw new Error("Failed to fetch token prices");
        }
    } catch (error) {
        console.error("Error fetching token prices:", error);
        throw error;
    }
}
```

#### `src/helpers/getTokenPricesCached.ts`
```ts
import { getTokenPrices } from "./getTokenPrices";

let cached: Record<string, number> | null = null;
let cachedAt = 0;
let inflight: Promise<Record<string, number>> | null = null;
const TTL = 60_000;

export async function getTokenPricesCached() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const prices = await getTokenPrices();
    cached = prices;
    cachedAt = Date.now();
    return prices;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
```

#### `src/helpers/getRewardsById.ts`
```ts
type TokenData = {
  amount: number;
  image: string;
  name: string;
  ticker: string;
  unclaimed: number;
  weeklyUser: number;
};

export function getTokenDataById(id: string): TokenData[] {
  const tokens: Record<string, TokenData[]> = {
    "0xb6d004fca4f9a34197862176485c45ceab7117c86f07422d1fe3d9cfd6e9d1da": [{
      amount: 648148,
      image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
      name: "Telcoin",
      ticker: "TEL",
      unclaimed: 0,
      weeklyUser: 0
    }],
    "0xfd56605f7f4620ab44dfc0860d70b9bd1d1f648a5a74558491b39e816a10b99a": [{
      amount: 560000,
      image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
      name: "Telcoin",
      ticker: "TEL",
      unclaimed: 0,
      weeklyUser: 0
    }],
    "0x9a005a0c12cc2ef01b34e9a7f3fb91a0e6304d377b5479bd3f08f8c29cdf5deb": [{
      amount: 648148,
      image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
      name: "Telcoin",
      ticker: "TEL",
      unclaimed: 0,
      weeklyUser: 0
    }],
    "0x29f94ec9b66df7fe4068e2d7e9bf0147b49afcdc7cd3283dff03088b8026169f": [{
      amount: 560000,
      image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
      name: "Telcoin",
      ticker: "TEL",
      unclaimed: 0,
      weeklyUser: 0
    }],
    "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b": [{
      amount: 648148,
      image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
      name: "Telcoin",
      ticker: "TEL",
      unclaimed: 0,
      weeklyUser: 0
    }],
    "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7": [{
      amount: 648148,
      image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
      name: "Telcoin",
      ticker: "TEL",
      unclaimed: 0,
      weeklyUser: 0
    }],
  };

  const defaultToken: TokenData[] = [{
    amount: 694444.5,
    image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
    name: "Telcoin",
    ticker: "TEL",
    unclaimed: 0,
    weeklyUser: 0
  }];

  return tokens[id] ?? defaultToken;
}
```

### Protocol-specific mappers (how grouped payload fields become UI data)

The grouped payload interpretations happen inside the `*GetSingleContractData(...)` functions.

#### Quickswap

##### `src/web3/getContracts/quickswap/getSingleContractData.ts`
```ts
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType } from "../all/createStakingContract";
import { quickswapGetStakeInfo } from "./getStakeInfo";
import { Decimals } from "../uniswapv4/getSingleContractData";
import { Position } from "@/app/api/uniswap-user-positions-polygon/route";

export async function quickswapGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined,
  subgraphInfoForQuickswapPool: any | undefined
) {
  const poolAddress = value.pool;
  const type = value.rewards.type as ContractType;

  let subgraphInfo = {} as any;
  subgraphInfo = subgraphInfoForQuickswapPool;

  let totalLiquidity;
  let dailyVolumeUSD;
  let fees24hr;

  let liquidityChartData = [] as any;
  let volumeChartData = [] as any;

  if (subgraphInfo) {
    totalLiquidity = subgraphInfo.pool ? subgraphInfo.pool.reserveUSD : undefined;
    if (subgraphInfo?.poolSnapshots?.length > 0) {
      dailyVolumeUSD = subgraphInfo.poolSnapshots[0].dailyVolumeUSD;
      fees24hr = dailyVolumeUSD != 0 ? dailyVolumeUSD * 0.003 : undefined;
    }
    if (subgraphInfo?.threeMonthLiquidityData?.length > 0) {
      liquidityChartData = subgraphInfo.threeMonthLiquidityData;
      volumeChartData = subgraphInfo.threeMonthLiquidityData;
    }
  }

  let stakeAddress = value.activeStakingAddress?.address;
  const deprecatedContractPresent =
    value.deprecatedStakingAddresses?.length > 0;

  let stakeInfo: any;

  if (stakeAddress) {
    stakeInfo = await quickswapGetStakeInfo(
      stakeAddress,
      poolAddress,
      type,
      totalLiquidity || 0,
      value,
      selectedWalletAddress
    );
  } else {
    // if no active staking address, use the latest deprecated address
    stakeAddress =
      value.deprecatedStakingAddresses?.[
        value.deprecatedStakingAddresses.length - 1
      ].address;
  }

  let stakeInfoDeprecated;
  let stakeAddressDeprecated: any = "";
  if (deprecatedContractPresent) {
    stakeAddressDeprecated =
      value.deprecatedStakingAddresses?.[
        value.deprecatedStakingAddresses.length - 1
      ].address;
    stakeInfoDeprecated = await quickswapGetStakeInfo(
      stakeAddressDeprecated,
      poolAddress,
      type,
      totalLiquidity || 0,
      value,
      selectedWalletAddress
    );
  }

  const contractData: any = {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    deprecated: value.deprecated,
    deprecatedStakingAddresses: value.deprecatedStakingAddresses,
    poolContractAddress: poolAddress,
    stakeContractAddress: stakeAddress,
    stakeAddressDeprecated: stakeAddressDeprecated,
    deprecatedContractPresent: deprecatedContractPresent,
    assets: value.assets,
    rewards: stakeInfo.rewards,
    rewardsInterval: value.rewards.rewardsInterval,
    protocol: "quickswap",
    blockchain: "polygon",
    totalLiquidity: totalLiquidity || 0,
    stakedLiquidity: stakeInfo.stakedLiquidity || 0,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics,
    userStaked: true,
    selectedWalletAddress: selectedWalletAddress,
    dailyVolumeUSD: dailyVolumeUSD ?? 0,
    fees24hr: fees24hr,
    illustration: value.illustration,
    user: {
      balanceLPT: Number(stakeInfo.balanceLPT),
      stakedLPT: Number(stakeInfo.stakedLPT),
      stakedUSD: stakeInfo.stakedUSD,
      deprecated: stakeInfoDeprecated
        ? {
          balanceLPT: Number(stakeInfoDeprecated.balanceLPT),
          stakedLPT: Number(stakeInfoDeprecated.stakedLPT),
          stakedUSD: stakeInfoDeprecated.stakedUSD,
          rewards: stakeInfoDeprecated.rewards,
        }
        : null,
    },
    stakingPeriod: value.stakingPeriod || "",
    vestingPeriod: "",
    vestingPeriodHelpText: undefined,
    totalStaked: stakeInfo?.totalStaked || null,
    totalSupply: stakeInfo?.totalSupply || null,
    subgraphId: value.subgraphId || "",
    liquidityChartData: liquidityChartData,
    volumeChartData: volumeChartData,
  };

  return contractData;
}
```

##### `src/web3/getContracts/quickswap/getStakeInfo.ts`
```ts
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import TOKEN_INFO from "../../token_info";
import {
  ContractType,
  createStakingContract,
} from "../all/createStakingContract";
import { getPoolContractValues } from "../all/getPoolContractValues";
import { formatUnits } from "ethers";

export interface Reward {
  name: string;
  ticker: string;
  image: string;
  amount: number;
  unclaimed: number;
  weeklyUser: number;
}

export async function quickswapGetStakeInfo(
  stakeAddress: string,
  poolAddress: string,
  type: ContractType,
  totalLiquidity: number,
  value: miningContract,
  selectedWalletAddress: string | undefined
) {
  const stakeContract = await createStakingContract(type, stakeAddress);

  const poolContractValues = await getPoolContractValues({
    poolAddress: poolAddress,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    totalLiquidity: totalLiquidity,
  });

  const {
    totalStaked,
    stakedLiquidity,
    currentTotalStakeAmount,
    poolContract,
    totalSupply,
  } = poolContractValues;

  let balanceLPT = 0;
  let stakedLPT = 0;
  let stakedUSD = 0;

  let balanceLPTString = "0";
  let stakedLPTString = "0";

  let currentUserStakeAmount = 0;
  let poolContributionRatio = 0;
  let pendingTelRewards = 0;
  let pendingQuickRewards = 0;

  if (selectedWalletAddress) {
    const [rawBalanceLPT, rawStakedLPT] = await Promise.all([
      poolContract.balanceOf(selectedWalletAddress),
      stakeContract.balanceOf(selectedWalletAddress),
    ]);

    balanceLPT = Number(formatUnits(rawBalanceLPT, 18));
    balanceLPTString = balanceLPT.toFixed(18);

    currentUserStakeAmount = Number(formatUnits(rawStakedLPT, 18));
    stakedLPT = currentUserStakeAmount;
    stakedLPTString = stakedLPT.toFixed(18);

    if (stakedLiquidity !== null) {
      stakedUSD = stakedLiquidity * (stakedLPT / totalStaked);
    }
    poolContributionRatio = currentUserStakeAmount / currentTotalStakeAmount;

    if (type === "single") {
      const rawTelRewards = await stakeContract.earned(selectedWalletAddress);
      pendingTelRewards = Number(formatUnits(rawTelRewards, 2));
    } else {
      const [rawTel, rawQuick] = await Promise.all([
        stakeContract.earnedA(selectedWalletAddress),
        stakeContract.earnedB(selectedWalletAddress),
      ]);
      pendingTelRewards = Number(formatUnits(rawTel, 2));
      pendingQuickRewards = Number(formatUnits(rawQuick, 18));
    }
  }

  const rewards: Reward[] = [];
  value?.rewards?.tokens?.map((rewardData) => {
    const reward = {} as Reward;
    switch (rewardData.ticker.toLowerCase()) {
      case "quick":
        reward.name = TOKEN_INFO.quick.name;
        reward.ticker = TOKEN_INFO.quick.ticker;
        reward.image = TOKEN_INFO.quick.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = pendingQuickRewards;
        reward.weeklyUser = poolContributionRatio * rewardData.amount;
        break;

      case "dquick":
        reward.name = TOKEN_INFO.dquick.name;
        reward.ticker = TOKEN_INFO.dquick.ticker;
        reward.image = TOKEN_INFO.dquick.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = pendingQuickRewards;
        reward.weeklyUser = poolContributionRatio * rewardData.amount;
        break;

      default:
        reward.name = TOKEN_INFO.tel.name;
        reward.ticker = TOKEN_INFO.tel.ticker;
        reward.image = TOKEN_INFO.tel.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = pendingTelRewards;
        reward.weeklyUser = poolContributionRatio * rewardData.amount;
        break;
    }
    rewards.push(reward);
  });

  return {
    balanceLPT: balanceLPTString,
    stakedLPT: stakedLPTString,
    stakedUSD: stakedUSD,
    stakedLiquidity: stakedLiquidity,
    rewards: rewards,
    totalSupply,
    totalStaked,
  };
}
```

#### Uniswap v4

##### `src/web3/getContracts/uniswapv4/getSingleContractData.ts`
```ts
import { getTokenDataById } from "@/helpers/getRewardsById";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { Position } from "@/app/api/uniswap-user-positions-polygon/route";

export async function uniswapGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined,
  subgraphInfoForPool: any | undefined
) {
  const poolAddress = value.pool;

  const rewards = getTokenDataById(poolAddress);

  let subgraphInfo = {} as any;
  subgraphInfo = subgraphInfoForPool;

  let totalLiquidity;
  let dailyVolumeUSD: number | undefined = 0;
  let fees24hr: number | undefined = 0;

  let liquidityChartData: any[] = [];
  let volumeChartData: any[] = [];
  let feeChartData: any[] = [];

  if (subgraphInfo) {
    const pool = subgraphInfo.pool;
    totalLiquidity = pool?.totalValueLockedUSD;

    const snapshots = subgraphInfo.poolSnapshots ?? [];

    const now = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgo = now - 86400;

    const filteredSnapshots = snapshots.filter((s: any) => Number(s.periodStartUnix) >= twentyFourHoursAgo);

    for (const snapshot of filteredSnapshots) {
      dailyVolumeUSD += Number(snapshot.volumeUSD);
      fees24hr += Number(snapshot.feesUSD);
    }

    if (!dailyVolumeUSD) dailyVolumeUSD = undefined;
    if (!fees24hr) fees24hr = undefined;

    if (subgraphInfo.weeklyVolume) {
      volumeChartData = subgraphInfo.weeklyVolume;
      feeChartData = subgraphInfo.weeklyVolume;
    }

    if (subgraphInfo?.threeMonthLiquidityData?.length > 0) {
      const sortedVolumeData = [...subgraphInfo.threeMonthLiquidityData].sort((a, b) => a.date - b.date);
      liquidityChartData = subgraphInfo.threeMonthLiquidityData;
      const modifiedVolumeData = sortedVolumeData.map((data, index) => {
        if (index === 0) return data;
        return {
          ...data,
          swapVolume: data.swapVolume - sortedVolumeData[index - 1].swapVolume,
          swapFees: data.swapFees - sortedVolumeData[index - 1].swapFees,
        };
      });
      volumeChartData = modifiedVolumeData;
    }
  }

  const deprecatedContractPresent = value.deprecatedStakingAddresses?.length > 0;
  let stakeInfo: any;

  let stakeAddressDeprecated = "";
  if (deprecatedContractPresent) {
    stakeAddressDeprecated = value.deprecatedStakingAddresses![value.deprecatedStakingAddresses.length - 1].address;
  }

  const temp = {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    deprecated: value.deprecated,
    deprecatedStakingAddresses: value.deprecatedStakingAddresses,
    poolContractAddress: poolAddress,
    stakeContractAddress: "",
    stakeAddressDeprecated,
    deprecatedContractPresent,
    assets: value.assets,
    rewards: rewards,
    rewardsInterval: value.rewards.rewardsInterval,
    protocol: value?.protocol || "uniswap",
    protocolVersion: value?.protocolVersion || "",
    blockchain: value?.blockchain || "polygon",
    totalLiquidity: totalLiquidity || 0,
    stakedLiquidity: stakeInfo?.stakedLiquidity || 0,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics,
    userStaked: true,
    selectedWalletAddress,
    dailyVolumeUSD: dailyVolumeUSD ?? 0,
    fees24hr,
    illustration: value.illustration,
    user: {
      balanceLPT: Number(stakeInfo?.balanceLPT),
      stakedLPT: Number(stakeInfo?.stakedLPT),
      stakedUSD: stakeInfo?.stakedUSD,
      deprecated: null,
    },
    stakingPeriod: value.stakingPeriod || "",
    vestingPeriod: "",
    vestingPeriodHelpText: undefined,
    totalStaked: stakeInfo?.totalStaked || null,
    totalSupply: stakeInfo?.totalSupply || null,
    subgraphId: value.subgraphId || "",
    liquidityChartData,
    volumeChartData,
    feeChartData,
    decimals: value.decimals
  };

  return temp;
}
```

#### Balancer

##### `src/web3/getContracts/balancer/getSingleContractData.ts`
```ts
import { getStakeInfo } from "./getStakeInfo";
import { getRewardsValuesNoStakingContract } from "./getRewardsValues";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType } from "../all/createStakingContract";
import { getPoolLiquidityValue } from "@/web3/getContracts/balancer/vault";
import { Decimals } from "../uniswapv4/getSingleContractData";
import { Position } from "@/app/api/uniswap-user-positions-polygon/route";

export async function balancerGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined,
  tokenPrices: Record<string, number>,
  subgraphInfoForBalancerPool: any | undefined
) {
  const poolAddress = value.pool;
  const type = value.rewards.type as ContractType;

  const subgraphId = value.subgraphId;

  let subgraphInfo = {} as any;
  subgraphInfo = subgraphInfoForBalancerPool && subgraphInfoForBalancerPool;

  let totalLiquidity: number = 0;
  let dailyVolumeUSD;
  let fees24hr;

  let liquidityChartData = [] as any;
  let volumeChartData = [] as any;

  if (subgraphInfo) {
    const tokenDecimals: Record<string, number> = {
      "0x27f485b62c4a7e635f561a87560adf5090239e93": 18,
      "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 6,
      "0xdf7837de1f2fa4631d716cf2502f8b230f1dcc32": 2,
      "0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3": 18,
      "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": 18,
      "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": 18,
      "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6": 8,
      "0xd6df932a45c0f255f85145f286ea0b292b21c90b": 18,
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": 6,
      "0xe7804d91dfcde7f776c90043e03eaa6df87e6395": 18,
    };

    totalLiquidity = await getPoolLiquidityValue(
      `${subgraphId}`,
      tokenDecimals,
      tokenPrices
    );

    if (subgraphInfo?.poolSnapshots?.length > 0) {
      if (subgraphInfo.poolSnapshots.length === 1) {
        dailyVolumeUSD = subgraphInfo.poolSnapshots[0].swapVolume;
        fees24hr = subgraphInfo.poolSnapshots[0].swapFees;
      } else {
        dailyVolumeUSD =
          subgraphInfo.poolSnapshots[1].swapVolume -
          subgraphInfo.poolSnapshots[0].swapVolume;
        fees24hr =
          subgraphInfo.poolSnapshots[1].swapFees -
          subgraphInfo.poolSnapshots[0].swapFees;
      }
    }
  }

  if (subgraphInfo?.threeMonthLiquidityData?.length > 0) {
    liquidityChartData = subgraphInfo.threeMonthLiquidityData;
  }

  if (subgraphInfo?.threeMonthLiquidityData?.length > 0) {
    const sortedVolumeData = [...subgraphInfo.threeMonthLiquidityData].sort((a, b) => a.date - b.date);
    const modifiedVolumeData = sortedVolumeData.map((data, index) => {
      if (index === 0) return data;
      return {
        ...data,
        swapVolume: data.swapVolume - sortedVolumeData[index - 1].swapVolume,
        swapFees: data.swapFees - sortedVolumeData[index - 1].swapFees,
      };
    });
    volumeChartData = modifiedVolumeData;
  }

  let stakeAddress = value.activeStakingAddress?.address;
  const deprecatedContractPresent = value.deprecatedStakingAddresses?.length > 0;

  let stakeInfo;
  if (stakeAddress) {
    stakeInfo = await getStakeInfo(
      stakeAddress,
      poolAddress,
      type,
      totalLiquidity,
      value,
      selectedWalletAddress
    );
  } else {
    stakeAddress = value.deprecatedStakingAddresses?.[0].address;
  }

  let stakeInfoDeprecated;
  let stakeAddressDeprecated = "";
  if (deprecatedContractPresent) {
    stakeAddressDeprecated =
      value.deprecatedStakingAddresses?.[
        value.deprecatedStakingAddresses.length - 1
      ].address;
    stakeInfoDeprecated = await getStakeInfo(
      stakeAddressDeprecated,
      poolAddress,
      type,
      totalLiquidity,
      value,
      selectedWalletAddress
    );
  }

  return {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    deprecated: value.deprecated,
    deprecatedStakingAddresses: value.deprecatedStakingAddresses,
    poolContractAddress: poolAddress,
    stakeContractAddress: stakeAddress,
    stakeAddressDeprecated: stakeAddressDeprecated,
    deprecatedContractPresent: deprecatedContractPresent,
    assets: value.assets,
    rewards: stakeInfo
      ? stakeInfo.rewards
      : await getRewardsValuesNoStakingContract({ rewardsInfo: value.rewards }),
    rewardsInterval: value.rewards.rewardsInterval,
    protocol: "balancer",
    blockchain: "polygon",
    totalLiquidity,
    stakedLiquidity: stakeInfo ? stakeInfo.stakedLiquidity : null,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics,
    userStaked: true,
    selectedWalletAddress,
    illustration: value.illustration,
    dailyVolumeUSD,
    user: {
      balanceLPT: stakeInfo ? stakeInfo.balanceLPT : 0,
      stakedLPT: stakeInfo ? stakeInfo.stakedLPT : 0,
      stakedUSD: stakeInfo ? stakeInfo.stakedUSD : 0,
      deprecated: stakeInfoDeprecated
        ? {
          balanceLPT: stakeInfoDeprecated.balanceLPT,
          stakedLPT: stakeInfoDeprecated.stakedLPT,
          stakedUSD: stakeInfoDeprecated.stakedUSD,
          rewards: stakeInfoDeprecated.rewards,
        }
        : null,
    },
    stakingPeriod: value.stakingPeriod,
    subgraphId: value.subgraphId,
    vestingPeriod: value.vestingPeriod,
    vestingPeriodHelpText: value.vestingPeriodHelpText,
    fees24hr,
    totalStaked: stakeInfo?.totalStaked || null,
    totalSupply: stakeInfo?.totalSupply || null,
    liquidityChartData,
    volumeChartData,
  };
}
```

##### `src/web3/getContracts/balancer/getStakeInfo.ts`
```ts
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType, createStakingContract } from "../all/createStakingContract";
import { getPoolContractValues } from "../all/getPoolContractValues";
import { getRewardsValues } from "./getRewardsValues";

export async function getStakeInfo(
  stakeAddress: string,
  poolAddress: string,
  type: ContractType,
  totalLiquidity: number,
  value: miningContract,
  selectedWalletAddress: string | undefined,
) {
  const stakeContract = await createStakingContract(type, stakeAddress);

  const poolContractValues = await getPoolContractValues({
    poolAddress: poolAddress,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    totalLiquidity: totalLiquidity,
  });
  const { totalStaked, stakedLiquidity, currentTotalStakeAmount, poolContract, totalSupply } = poolContractValues;

  const rewardsValues = await getRewardsValues({
    selectedWalletAddress: selectedWalletAddress,
    poolContract: poolContract,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    stakedLiquidity: stakedLiquidity,
    totalStaked: totalStaked,
    currentTotalStakeAmount: currentTotalStakeAmount,
    type: type,
    rewardsInfo: value.rewards,
  });

  const { balanceLPT, stakedLPT, stakedUSD, rewards } = rewardsValues || {
    balanceLPT: undefined,
    stakedLPT: undefined,
    stakedUSD: undefined,
    rewards: undefined,
  };

  return {
    balanceLPT,
    stakedLPT,
    stakedUSD,
    stakedLiquidity,
    rewards,
    totalSupply,
    totalStaked,
  };
}
```

Note: For Balancer, the full on-chain stake/reward helpers are in:
- `src/web3/getContracts/balancer/getStakeInfo.ts`
- `src/web3/getContracts/balancer/getRewardsValues.ts`
- `src/web3/getContracts/balancer/vault.ts`

These are included below as-is.

##### `src/web3/getContracts/balancer/getStakeInfo.ts` (full)
```ts
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ContractType, createStakingContract } from "../all/createStakingContract";
import { getPoolContractValues } from "../all/getPoolContractValues";
import { getRewardsValues } from "./getRewardsValues";

export async function getStakeInfo(
  stakeAddress: string,
  poolAddress: string,
  type: ContractType,
  totalLiquidity: number,
  value: miningContract,
  selectedWalletAddress: string | undefined,
) {
  const stakeContract = await createStakingContract(type, stakeAddress);

  const poolContractValues = await getPoolContractValues({
    poolAddress: poolAddress,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    totalLiquidity: totalLiquidity,
  });
  const { totalStaked, stakedLiquidity, currentTotalStakeAmount, poolContract, totalSupply } = poolContractValues;

  const rewardsValues = await getRewardsValues({
    selectedWalletAddress: selectedWalletAddress,
    poolContract: poolContract,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    stakedLiquidity: stakedLiquidity,
    totalStaked: totalStaked,
    currentTotalStakeAmount: currentTotalStakeAmount,
    type: type,
    rewardsInfo: value.rewards,
  });

  const { balanceLPT, stakedLPT, stakedUSD, rewards } = rewardsValues || {
    balanceLPT: undefined,
    stakedLPT: undefined,
    stakedUSD: undefined,
    rewards: undefined,
  };

  return {
    balanceLPT,
    stakedLPT,
    stakedUSD,
    stakedLiquidity,
    rewards,
    totalSupply,
    totalStaked,
  };
}
```

##### `src/web3/getContracts/balancer/getRewardsValues.ts` (full)
```ts
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import TOKEN_INFO from "../../token_info";
import { Reward } from "../quickswap/getStakeInfo";
import { ContractType } from "../all/createStakingContract";
import { STAKE_ADDRESS_TEL_DFX } from "@/lib/constants";
import { Contract, formatUnits } from "ethers";

interface GetRewardsValuesProps {
  selectedWalletAddress?: string;
  poolContract: Contract;
  stakeAddress: string;
  stakeContract: Contract;
  stakedLiquidity: number | null;
  totalStaked: number;
  currentTotalStakeAmount: number;
  type: ContractType;
  rewardsInfo: miningContract["rewards"];
}

interface RewardsValuesResult {
  balanceLPT: string;
  stakedLPT: string;
  stakedUSD: number;
  rewards: Reward[];
}

export const getRewardsValues = async (
  props: GetRewardsValuesProps
): Promise<RewardsValuesResult> => {
  const {
    selectedWalletAddress,
    poolContract,
    stakeAddress,
    stakeContract,
    stakedLiquidity,
    totalStaked,
    currentTotalStakeAmount,
    type,
    rewardsInfo,
  } = props;

  let balanceLPT = 0;
  let stakedLPT = 0;
  let stakedUSD = 0;
  let currentUserStakeAmount = 0;
  let poolContributionRatio = 0;
  let pendingTelRewards = 0;
  let pendingSecondaryRewards = 0;

  if (selectedWalletAddress) {
    try {
      const [rawBalanceLPT, rawStakedLPT] = await Promise.all([
        poolContract.balanceOf(selectedWalletAddress),
        stakeContract.balanceOf(selectedWalletAddress),
      ]);

      // Convert BigNumbers to numbers
      balanceLPT = Number(formatUnits(rawBalanceLPT, 18));
      currentUserStakeAmount = Number(formatUnits(rawStakedLPT, 18));
      stakedLPT = currentUserStakeAmount;

      stakedUSD = stakedLiquidity
        ? stakedLiquidity * (stakedLPT / totalStaked)
        : 0;

      poolContributionRatio = currentUserStakeAmount / currentTotalStakeAmount;

      // Handle rewards based on contract type
      if (type === "single") {
        const rawTelRewards = await stakeContract.earned(selectedWalletAddress);
        pendingTelRewards = Number(formatUnits(rawTelRewards, 2));
      } else if (type === "multi") {
        const [secondaryRewards, telRewards] = await stakeContract.earned(
          selectedWalletAddress
        );
        pendingTelRewards = Number(formatUnits(telRewards, 18));
        pendingSecondaryRewards = Number(formatUnits(secondaryRewards, 18));
      }

      // Special case handling
      if (stakeAddress === STAKE_ADDRESS_TEL_DFX) {
        const rawDfxRewards = await stakeContract.earnedA(selectedWalletAddress);
        pendingSecondaryRewards = Number(formatUnits(rawDfxRewards, 18));
      }
    } catch (error) {
      console.error("Error fetching rewards values:", error);
    }
  }

  const rewards: Reward[] = [];
  rewardsInfo?.tokens?.forEach((rewardData) => {
    const reward: Reward = {
      name: "",
      ticker: "",
      image: "",
      amount: rewardData.amount,
      unclaimed: 0,
      weeklyUser: poolContributionRatio * rewardData.amount || 0,
    };

    switch (rewardData.ticker.toLowerCase()) {
      case "dfx":
        reward.name = TOKEN_INFO.dfx.name;
        reward.ticker = TOKEN_INFO.dfx.ticker;
        reward.image = TOKEN_INFO.dfx.image;
        reward.unclaimed = pendingSecondaryRewards;
        break;

      default:
        // Default to TEL rewards
        reward.name = TOKEN_INFO.tel.name;
        reward.ticker = TOKEN_INFO.tel.ticker;
        reward.image = TOKEN_INFO.tel.image;
        reward.unclaimed =
          stakeAddress === STAKE_ADDRESS_TEL_DFX ? 0 : pendingTelRewards;
        break;
    }
    rewards.push(reward);
  });

  return {
    balanceLPT: balanceLPT.toFixed(18),
    stakedLPT: stakedLPT.toFixed(18),
    stakedUSD,
    rewards,
  };
};

interface AirdroppedReward extends Omit<Reward, "unclaimed" | "weeklyUser"> {
  unclaimed?: never;
  weeklyUser?: never;
}

export const getRewardsValuesNoStakingContract = async (props: {
  rewardsInfo: miningContract["rewards"];
}): Promise<AirdroppedReward[]> => {
  const { rewardsInfo } = props;
  const rewards: any[] = [];

  rewardsInfo?.tokens?.forEach((rewardData) => {
    const baseReward = {
      amount: rewardData.amount,
      unclaimed: 0,
      weeklyUser: 0,
    };

    switch (rewardData.ticker.toLowerCase()) {
      case "bal":
        rewards.push({
          ...baseReward,
          name: TOKEN_INFO.bal.name,
          ticker: TOKEN_INFO.bal.ticker,
          image: TOKEN_INFO.bal.image,
        });
        break;

      case "dfx":
        rewards.push({
          ...baseReward,
          name: TOKEN_INFO.dfx.name,
          ticker: TOKEN_INFO.dfx.ticker,
          image: TOKEN_INFO.dfx.image,
        });
        break;

      default:
        rewards.push({
          ...baseReward,
          name: TOKEN_INFO.tel.name,
          ticker: TOKEN_INFO.tel.ticker,
          image: TOKEN_INFO.tel.image,
        });
        break;
    }
  });

  return rewards;
};
```

##### `src/web3/getContracts/balancer/vault.ts` (full)
```ts
import { provider } from "@/lib/alchemySdk";
import { Contract, ethers } from "ethers";
import VAULT_ABI from "@/web3/abis/balancer/vault.json";

export const getPoolLiquidityValue = async (
  poolId: string,
  tokenDecimals: Record<string, number>,
  tokenPrices: Record<string, number>
) => {
  const vaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const vaultContract = new Contract(vaultAddress, VAULT_ABI, provider);
  // Get pool tokens and balances
  const { tokens, balances } = await vaultContract.getPoolTokens(poolId);
  const normalizedTokens = tokens.map((token: string) => token.toLowerCase());

  let totalLiquidityUSD = 0;

  normalizedTokens.forEach((token: number, index: number) => {
    const decimals = tokenDecimals[token];
    const balance = parseFloat(ethers.formatUnits(balances[index], decimals));
    const valueUSD = balance * tokenPrices[token];
    totalLiquidityUSD += valueUSD;
  });

  return totalLiquidityUSD;
};
```

#### DFX

##### `src/web3/getContracts/dfx/getSingleContractData.ts`
```ts
import { dfxGetStakeInfo } from "./getStakeInfo";
import { dfxGetSubgraphInfo, DfxSubgraphInfo } from "./getSubgraphInfo";
import { getTimestampForStartOfDay } from "../../../helpers/getTimestamp";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { ApolloQueryResult } from "@apollo/client";
import { ContractType } from "../all/createStakingContract";
import { ProtocolsContractData } from "../shared";
import { Decimals } from "../uniswapv4/getSingleContractData";
import { Position } from "@/app/api/uniswap-user-positions-polygon/route";

export async function dfxGetSingleContractData(
  value: miningContract,
  selectedWalletAddress: string | undefined
): Promise<any> {
  const poolAddress = value.pool;
  const subgraphId = value.subgraphId;
  const type = value?.rewards.type as ContractType;

  let subgraphInfo = {} as ApolloQueryResult<any>;
  if (value.fetchSubgraph) {
    try {
      const response = await fetch(`/api/backend/subgraphs/dfx?poolAddress=${poolAddress}`);
      if (response.ok) {
        const { redisData } = await response.json();
        subgraphInfo = redisData.data;
      } else {
        throw new Error(`Error fetching DFX subgraph data from backend. pool address:${poolAddress}`);
      }
    } catch (e) {
      console.error("Error fetching from DFX data from backend, falling back to subgraph", e);
      try {
        subgraphInfo = await dfxGetSubgraphInfo(poolAddress);
      } catch (subgraphError) {
        console.error("Fallback to DFX subgraph failed", subgraphError);
      }
    }
  }

  let totalLiquidity: number | undefined;
  let dailyVolumeUSD: any;
  let liquidityChartData = [] as any;
  let volumeChartData = [] as any;

  if (subgraphInfo.data) {
    totalLiquidity = subgraphInfo.data.pair ? subgraphInfo.data.pair.reserveUSD : undefined;
    dailyVolumeUSD = subgraphInfo.data.pairDayData ? subgraphInfo.data.pairDayData.volumeUSD : undefined;
  }
  if (subgraphInfo.data?.quarterYearLiquidityData?.length > 0) {
    liquidityChartData = subgraphInfo.data.quarterYearLiquidityData;
  }
  if (subgraphInfo.data?.quarterYearVolumeData?.length > 0) {
    volumeChartData = subgraphInfo.data.quarterYearVolumeData;
  }

  let stakeAddress = value.activeStakingAddress?.address;
  let stakeInfo: any;
  if (stakeAddress) {
    stakeInfo = await dfxGetStakeInfo(
      stakeAddress,
      poolAddress,
      type,
      totalLiquidity ?? 0,
      value,
      selectedWalletAddress
    );
  } else {
    stakeAddress = value.deprecatedStakingAddresses?.[0].address;
  }

  const deprecatedContractPresent = value.deprecatedStakingAddresses?.length > 0;
  let stakeInfoDeprecated: any;
  let stakeAddressDeprecated = "";
  if (deprecatedContractPresent) {
    stakeAddressDeprecated =
      value.deprecatedStakingAddresses?.[
        value.deprecatedStakingAddresses.length - 1
      ].address;
    stakeInfoDeprecated = await dfxGetStakeInfo(
      stakeAddressDeprecated,
      poolAddress,
      type,
      totalLiquidity ?? 0,
      value,
      selectedWalletAddress
    );
  }

  const getPairIdTimestamp = () => {
    const timestamp = getTimestampForStartOfDay();
    return Math.trunc(timestamp / 86400);
  };
  const pairIdTimestamp = getPairIdTimestamp();

  return {
    activeStakingAddress: value.activeStakingAddress,
    name: value.name,
    deprecated: value.deprecated,
    deprecatedStakingAddresses: value.deprecatedStakingAddresses,
    poolContractAddress: poolAddress,
    stakeContractAddress: stakeAddress,
    stakeAddressDeprecated: stakeAddressDeprecated,
    assets: value.assets,
    rewards: stakeInfo?.rewards,
    rewardsInterval: value?.rewards.rewardsInterval,
    protocol: "dfx",
    blockchain: "polygon",
    totalLiquidity: stakeInfo?.stakedLiquidity || 0,
    stakedLiquidity: stakeInfo?.stakedLiquidity,
    addLiquidityLink: value.links.addLiquidity,
    poolAnalyticsLink: value.links.poolAnalytics || undefined,
    userStaked: true,
    selectedWalletAddress,
    dailyVolumeUSD: dailyVolumeUSD || 0,
    illustration: value.illustration,
    subgraphId: subgraphId || '',
    pairIdTimestamp,
    user: {
      balanceLPT: stakeInfo?.balanceLPT,
      stakedLPT: stakeInfo?.stakedLPT,
      stakedUSD: stakeInfo?.stakedUSD,
      deprecated: stakeInfoDeprecated
        ? {
          balanceLPT: stakeInfoDeprecated.balanceLPT,
          stakedLPT: stakeInfoDeprecated.stakedLPT,
          stakedUSD: stakeInfoDeprecated.stakedUSD,
          rewards: stakeInfoDeprecated?.rewards,
        }
        : undefined,
    },
    stakingPeriod: value.stakingPeriod,
    deprecatedContractPresent: undefined,
    fees24hr: undefined,
    vestingPeriod: undefined,
    vestingPeriodHelpText: undefined,
    totalStaked: stakeInfo?.totalStaked || 0,
    totalSupply: stakeInfo?.totalSupply || 0,
    liquidityChartData,
    volumeChartData,
  };
}
```

##### `src/web3/getContracts/dfx/getStakeInfo.ts`
```ts
import {
  ContractType,
  createStakingContract,
} from "../all/createStakingContract";
import { getPoolContractValues } from "../all/getPoolContractValues";
import TOKEN_INFO from "../../token_info";
import { miningContract } from "../../../helpers/normalizeMiningContracts";
import { Reward } from "../quickswap/getStakeInfo";
import { formatUnits } from "ethers";

export async function dfxGetStakeInfo(
  stakeAddress: string,
  poolAddress: string,
  type: ContractType,
  totalLiquidity: number,
  value: miningContract,
  selectedWalletAddress: string | undefined
) {
  const stakeContract = await createStakingContract(type, stakeAddress);

  const poolContractValues = await getPoolContractValues({
    poolAddress: poolAddress,
    stakeAddress: stakeAddress,
    stakeContract: stakeContract,
    totalLiquidity: totalLiquidity,
  });

  const {
    totalStaked,
    stakedLiquidity,
    currentTotalStakeAmount,
    poolContract,
    totalSupply,
  } = poolContractValues;

  let balanceLPT = 0;
  let stakedLPT = 0;
  let stakedUSD = 0;
  let balanceLPTString = "0";
  let stakedLPTString = "0";

  let poolContributionRatio = 0;
  let pendingDFXRewards: number;

  if (selectedWalletAddress) {
    try {
      const [rawBalanceLPT, rawStakedLPT, rawPendingRewards] =
        await Promise.all([
          poolContract.balanceOf(selectedWalletAddress),
          stakeContract.balanceOf(selectedWalletAddress),
          stakeContract.earned(selectedWalletAddress),
        ]);

      balanceLPT = Number(formatUnits(rawBalanceLPT, 18));
      balanceLPTString = formatUnits(rawBalanceLPT, 18);

      stakedLPT = Number(formatUnits(rawStakedLPT, 18));
      stakedLPTString = `${stakedLPT}`;

      if (stakedLiquidity !== null) {
        stakedUSD = stakedLiquidity * (stakedLPT / totalStaked);
      }

      poolContributionRatio = stakedLPT / currentTotalStakeAmount;
      pendingDFXRewards = parseFloat(formatUnits(rawPendingRewards[0], 18));
    } catch (error) {
      console.error("Error fetching DFX stake info:", error);
    }
  }

  const rewards: Reward[] = [];
  value.rewards.tokens.map((rewardData) => {
    const reward = {} as Reward;
    switch (rewardData.ticker) {
      case "DFX Finance":
      case "DFX":
      case "DFX ticker":
      case "DFX Ticker":
        reward.name = TOKEN_INFO.dfx.name;
        reward.ticker = TOKEN_INFO.dfx.ticker;
        reward.image = TOKEN_INFO.dfx.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = pendingDFXRewards;
        reward.weeklyUser = poolContributionRatio * rewardData.amount;
        break;
      default:
        reward.name = TOKEN_INFO.tel.name;
        reward.ticker = TOKEN_INFO.tel.ticker;
        reward.image = TOKEN_INFO.tel.image;
        reward.amount = rewardData.amount;
        reward.unclaimed = 0;
        reward.weeklyUser = (stakedUSD * rewardData.amount) / totalLiquidity;
        break;
    }
    rewards.push(reward);
  });

  return {
    balanceLPT,
    stakedLPT: stakedLPTString,
    stakedUSD,
    stakedLiquidity: stakedLiquidity,
    rewards,
    totalStaked,
    totalSupply,
  };
}
```

##### `src/web3/getContracts/dfx/getSubgraphInfo.ts`
```ts
import { ApolloClient, HttpLink, InMemoryCache, gql } from "@apollo/client";
import { getTimestampForStartOfDay } from "../../../helpers/getTimestamp";

const httpLink = new HttpLink({
  uri: "/api/dfx",
  headers: { "Content-Type": "application/json" },
});

const client = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache(),
});

export interface DfxSubgraphInfo {
  pair: { reserveUSD: number };
  pairDayData: { volumeUSD: number };
  quarterYearLiquidityData: Array<{ date: number; reserveUSD: number }>;
  quarterYearVolumeData: Array<{ date: number; volumeUSD: number }>;
}

export async function dfxGetSubgraphInfo(poolAddress: string) {
  const getPairIdTimestamp = () => {
    const timestamp = getTimestampForStartOfDay();
    return Math.trunc(timestamp / 86400);
  };

  const pairIdTimestamp = getPairIdTimestamp();
  const lowerCasePoolAddress = poolAddress.toLowerCase();

  return client.query({
    query: gql`
      {
        pair(id: "${lowerCasePoolAddress}") {
          reserveUSD
        }
        pairDayData(id: "${lowerCasePoolAddress}-${pairIdTimestamp}") {
          volumeUSD
        }
        quarterYearLiquidityData: pairDayDatas(
          first: 90,
          orderBy: date,
          orderDirection: desc,
          where: { pair: "${lowerCasePoolAddress}" }
        ) {
          date
          reserveUSD
        }
        quarterYearVolumeData: pairDayDatas(
          first: 90,
          orderBy: date,
          orderDirection: desc,
          where: { pair: "${lowerCasePoolAddress}" }
        ) {
          date
          volumeUSD
        }
      }
    `,
  });
}
```

### Shared on-chain helpers used by stake calculations

#### `src/web3/getContracts/all/createStakingContract.ts`
```ts
import { ethers } from "ethers";
import SINGLE_STAKING_ABI from "../../abis/staking_single_rewards.json";
import DUAL_STAKING_ABI from "../../abis/staking_dual_rewards.json";
import MULTI_STAKING_ABI from "../../abis/staking_multi_rewards.json";
import { provider } from "@/lib/alchemySdk";

export type ContractType = "single" | "double" | "multi";

export async function createStakingContract(
  type: ContractType,
  stakeAddress: string
) {
  let abi;

  switch (type) {
    case "single":
      abi = SINGLE_STAKING_ABI;
      break;
    case "double":
      abi = DUAL_STAKING_ABI;
      break;
    case "multi":
      abi = MULTI_STAKING_ABI;
      break;
    default:
      throw new Error(`Unsupported ContractType: ${type}`);
  }

  return new ethers.Contract(stakeAddress, abi, provider);
}
```

#### `src/web3/getContracts/all/getPoolContractValues.ts`
```ts
import TOKEN_ABI from "@/web3/abis/token.json";
import { Contract, ethers } from "ethers";
import { provider } from "@/lib/alchemySdk";

interface GetPoolContractValuesProps {
  poolAddress: string;
  stakeAddress: string;
  totalLiquidity: number;
  stakeContract: Contract;
}

export const getPoolContractValues = async (
  props: GetPoolContractValuesProps
) => {
  const { poolAddress, stakeAddress, totalLiquidity, stakeContract } = props;

  const poolContract = new ethers.Contract(poolAddress, TOKEN_ABI, provider);

  const [totalSupply, totalStaked, currentTotalStakeAmount] = await Promise.all([
    poolContract.totalSupply(),
    poolContract.balanceOf(stakeAddress),
    stakeContract.totalSupply(),
  ]);

  const formattedTotalSupply = parseFloat(ethers.formatUnits(totalSupply, 18));
  const formattedTotalStaked = parseFloat(ethers.formatUnits(totalStaked, 18));
  const formattedStakeTotal = parseFloat(ethers.formatUnits(currentTotalStakeAmount, 18));

  const stakedLiquidity =
    totalLiquidity && formattedTotalSupply > 0
      ? (formattedTotalStaked / formattedTotalSupply) * totalLiquidity
      : null;

  return {
    totalSupply: formattedTotalSupply,
    totalStaked: formattedTotalStaked,
    stakedLiquidity: stakedLiquidity,
    currentTotalStakeAmount: formattedStakeTotal,
    poolContract,
  };
};
```

