# api.telx.network Integration (TELx Frontend)

This document covers how the frontend gets pool data from the TELx backend at `https://api.telx.network`.
Pool data means TVL, 24h volume, 24h fees, and the history behind the pool charts.
The backend queries The Graph on a cron, derives per-pool metrics, and caches the result.
The frontend reads that cache and does as little math as it can.

## The path from page load to Redux

1. `AppLayout` loads `src/data/pool.json` into the contracts slice with `initializeList`.
2. `AppLayout` dispatches `fetchAllContractData(address)`.
3. The thunk calls `getAllContractData` in `src/web3/getContracts/shared.ts`.
4. `getAllContractData` calls `prefetchGroupedSubgraph`, which calls `fetchGroupedSubgraph` once per backend group.
5. `fetchGroupedSubgraph` calls an internal route, `/api/backend/subgraphs/<group>-grouped`.
6. The internal route calls `api.telx.network` with the backend secret.
7. A protocol reader turns each pool's grouped row into contract data.
8. The slice stores the contract data, the totals, and the data freshness.

The browser never calls `api.telx.network`. Only the Next.js route handlers and the registry sync script do.

## Endpoints

| Caller | Backend endpoint | Group |
| --- | --- | --- |
| `/api/backend/subgraphs/uniswap-base-grouped` | `GET /api/v1/active/get/uniswap-base-grouped` | `uniswap-base` |
| `/api/backend/subgraphs/uniswap-polygon-grouped` | `GET /api/v1/active/get/uniswap-polygon-grouped` | `uniswap-polygon` |
| `/api/backend/subgraphs/uniswap-ethereum-grouped` | `GET /api/v1/active/get/uniswap-ethereum-grouped` | `uniswap-ethereum` |
| `/api/backend/subgraphs/balancer-grouped` | `GET /api/v1/active/get/balancer-grouped` | `balancer` |
| `/api/backend/subgraphs/quickswap-grouped` | `GET /api/v1/active/get/quickswap-grouped` | `quickswap` |
| `npm run sync:pools` | `GET /api/v1/pools` | none, see [Pool registry](#pool-registry) |

Each internal route lives at `src/app/api/backend/subgraphs/<group>-grouped/route.ts`.
There is no DFX endpoint any more. The DFX subgraph is gone, and the DFX routes were deleted.

### Authentication

Every call sends `Authorization: Bearer ${TELX_BACKEND_SECRET_KEY}`.
Set `TELX_BACKEND_SECRET_KEY` in `.env.local`. It is a server-only variable.
The route handlers hard-code the backend URL. Only the sync script reads `TELX_BACKEND_URL`.

A request to the backend looks like this:

```http
GET /api/v1/active/get/uniswap-base-grouped HTTP/1.1
Host: api.telx.network
Authorization: Bearer <TELX_BACKEND_SECRET_KEY>
```

### What a route handler does

Each handler fetches the backend with `{ headers, next: { revalidate: 30 } }`.
Next.js reuses a backend response for up to 30 seconds before it revalidates.
On success, the handler returns the whole backend JSON unchanged. It does not unwrap `data`.

On a non-OK backend response, the handler returns `{ error: "Backend request failed", status, body }` with the backend's status code.

## Response shape

Every grouped endpoint returns one object:

```json
{
  "fetchedAt": 1758900000000,
  "indexedAt": 1758899990000,
  "hasIndexingErrors": false,
  "parts": {
    "hourly": { "fetchedAt": 1758900000000, "indexedAt": 1758899990000, "hasIndexingErrors": false },
    "daily": { "fetchedAt": 1758898800000, "indexedAt": 1758898790000, "hasIndexingErrors": false },
    "legacy": false
  },
  "data": [
    {
      "id": "0x727b...829b",
      "pool": { "id": "0x727b...829b", "totalValueLockedUSD": "123456.78" },
      "poolSnapshots": [],
      "threeMonthLiquidityData": [],
      "metrics": {
        "tvlUSD": 123456.78, "volume24h": 0, "fees24h": 0, "window": "trailing-24h",
        "lastActivityAt": null, "lastSwapAt": null, "createdAt": 1735689600,
        "rows24h": 0, "computedAt": 1758900000
      }
    }
  ]
}
```

Top-level fields:

- `fetchedAt` is when the backend fetched the subgraph data, in unix milliseconds.
- `indexedAt` is the timestamp of the subgraph's latest indexed block, in unix milliseconds. It is `null` when unknown.
- `hasIndexingErrors` is `true` when a subgraph reported indexing errors. It is `null` for a legacy payload.
- `parts` holds the same three fields per backend cache key. The frontend does not read it.
- `data` holds one element per pool in the group, active and archived.

Fields of each `data` element:

- `id` is the lowercase pool id. For Uniswap it is the v4 pool id. For Balancer it is the subgraph pool id. For QuickSwap it is the pair address.
- `pool` is the subgraph pool entity.
- `poolSnapshots` holds recent rows. Uniswap rows are hourly. Balancer and QuickSwap rows are daily.
- `threeMonthLiquidityData` holds the daily history the charts use.
- `swaps` holds Balancer swaps from the last 24 hours. Other protocols do not have it.
- `metrics` holds the values the backend derived. A legacy payload does not have it.

### Legacy payloads

`fetchGroupedSubgraph` accepts three shapes:

- The object above. Freshness comes from the top-level fields.
- An object with fewer fields, such as `{ fetchedAt, data }` from an older backend. Missing freshness fields become `null`.
- A bare array, from a backend older than the `{ fetchedAt, data }` shape. All freshness fields are `null`.

Pools without `metrics` fall back to the local math described in [Readers](#readers).

When the object carries `parts.legacy: true`, part of it comes from the backend's frozen `:v1` entry, and `fetchedAt` is the age of those rows.
The fallback applies only while `fetchedAt` is less than `LEGACY_FALLBACK_MAX_AGE_MS` (one hour) old.
After that, or when `fetchedAt` is missing, `fetchGroupedSubgraph` sets a missing `metrics` to `null`, so the readers show the values as unknown instead of summing rows that no longer cover the last 24 hours.
A pool that already has `metrics`, such as one whose daily part was borrowed, keeps them.

## Fetch helpers

### `fetchGroupedSubgraph(group)`

File: `src/helpers/fetchGroupedSubgraph.ts`.

It takes a backend group name (`SubgraphGroup`), such as `"uniswap-base"`.
It calls the matching internal route and returns `{ byId, list, meta }`:

- `list` is the `data` array.
- `byId` maps each lowercase pool id to its element.
- `meta` is `{ fetchedAt, indexedAt, hasIndexingErrors }` (`SubgraphMeta`).

It throws when the route responds with a non-OK status.

### `prefetchGroupedSubgraph(contracts, ttlMs?)`

File: `src/helpers/prefetchGroupedSubgraph.ts`.

It fetches a group when at least one pool of that group has `fetchSubgraph: true` in `pool.json`.
The groups load in parallel with `Promise.allSettled`.
It returns `{ quickswapById, uniswapById, balancerById, meta }`:

- `quickswapById` and `balancerById` are the `byId` maps of their groups.
- `uniswapById` merges the three Uniswap groups. Each key is prefixed with its chain, as in `base:0x727b...`.
- `meta` is a `DataFreshness`, built by `combineSubgraphMeta`.

`DataFreshness` combines the groups that loaded:

- `fetchedAt` and `indexedAt` are the oldest non-null values.
- `hasIndexingErrors` is `true` when any group reports errors, and `null` when no group reports either way.
- `sources` holds each group's own `SubgraphMeta`.

A group that fails to load is logged. Its pools get no grouped row, and it is missing from `sources`.

The result is cached in module memory for 60 seconds, including a result with a failed group.
Concurrent calls with the same pool list share one request.

### Lookup keys

`getAllContractData` finds each pool's grouped row by these keys.

| Protocol | Map | Key |
| --- | --- | --- |
| Uniswap | `uniswapById` | `<blockchain>:<pool id, lowercase>` |
| Balancer | `balancerById` | `subgraph_id` from `pool.json`, lowercase |
| QuickSwap | `quickswapById` | pool address, lowercase |
| DFX | none | no lookup |

## Metrics

Type: `PoolMetrics` in `src/types/PoolMetrics.ts`. It mirrors `lib/metrics.ts` in the backend.

| Field | Type | Meaning |
| --- | --- | --- |
| `tvlUSD` | `number \| null` | Pool TVL in USD from the subgraph. |
| `volume24h` | `number \| null` | Volume in USD over `window`. |
| `fees24h` | `number \| null` | Fees in USD over `window`. |
| `window` | `MetricsWindow \| null` | `"trailing-24h"`, `"trailing-24h-interpolated"`, or `"utc-day"`. |
| `lastActivityAt` | `number \| null` | Newest row of any kind in the fetched rows. |
| `lastSwapAt` | `number \| null` | Newest row or swap with volume above zero. |
| `createdAt` | `number \| null` | Pool creation time from the subgraph. |
| `rows24h` | `number` | Rows or swaps inside the window. |
| `computedAt` | `number` | The "now" the backend used. |

The four time fields in `metrics` are unix seconds.
`fetchedAt` and `indexedAt` are unix milliseconds. Do not mix them up.

### Null versus zero

- `null` means the value is unknown. The backend could not derive it, the group failed to load, or the pool has no grouped row.
- `0` means the pool was indexed and had no swaps in the window.

Show `null` as unavailable. Show `0` as a value.
The slice counts `null` as `0` when it sums the totals.

### Windows per protocol

| Protocol | TVL shown | 24h volume and fees | `window` |
| --- | --- | --- | --- |
| Uniswap | `metrics.tvlUSD` | Sum of hourly rows from the last 24 hours. | `trailing-24h` |
| Balancer | On-chain, from the Vault | Sum of swaps from the last 24 hours. Fees use the pool's swap fee. Without swaps, interpolated from daily snapshots. | `trailing-24h` or `trailing-24h-interpolated` |
| QuickSwap | `metrics.tvlUSD` | Volume of the current UTC day. Fees are 0.3% of it. It resets at 00:00 UTC. | `utc-day` |
| DFX | Staked liquidity, or `0` | `null` | none |

## Readers

Each reader lives in `src/web3/getContracts/<protocol>/getSingleContractData.ts`.
Each reads `metrics` first. It falls back to local math only when `metrics` is missing, which happens with a legacy payload recent enough to trust (see [Legacy payloads](#legacy-payloads)).

`uniswapGetSingleContractData` (folder `uniswapv4`):

- With `metrics`: `totalLiquidity`, `dailyVolumeUSD`, and `fees24hr` come from `tvlUSD`, `volume24h`, and `fees24h`.
- Without `metrics`: TVL is `pool.totalValueLockedUSD`. Volume and fees sum the `poolSnapshots` rows from the last 24 hours. No rows gives `0`.
- Without a grouped row: all three are `null`.

`balancerGetSingleContractData`:

- TVL comes from the chain. `getPoolLiquidityValue` in `src/web3/getContracts/balancer/vault.ts` reads the Vault balances and prices them. `metrics.tvlUSD` is not used.
- The TVL read runs only when the pool has a grouped row. Without one, TVL is `null`.
- With `metrics`: volume and fees come from `volume24h` and `fees24h`.
- Without `metrics`: volume and fees are the difference between the first two `poolSnapshots`, which hold daily cumulative totals. This is not a trailing 24 hours. No snapshots gives `null`.

`quickswapGetSingleContractData`:

- With `metrics`: all three values come from `metrics`.
- Without `metrics`: TVL is `pool.reserveUSD`. Volume is the newest `poolSnapshots` row's `dailyVolumeUSD`. Fees are 0.3% of it. No rows gives `null`.

`dfxGetSingleContractData`:

- It makes no backend call.
- `dailyVolumeUSD` and `fees24hr` are `null`. The chart arrays are empty.
- The on-chain stake reads receive `0` as total liquidity. `totalLiquidity` is the staked liquidity they return, or `0`.

When `metrics` is present, every reader copies four more fields onto the contract data with `activityFields` from `src/helpers/poolMetrics.ts`.
They are `volume24hWindow` (from `window`), `lastActivityAt`, `lastSwapAt`, and `createdAt`.

The chart arrays (`liquidityChartData`, `volumeChartData`) come from `threeMonthLiquidityData`, not from `metrics`.
`src/components/chart/chart.ts` turns them into chart series.

## Redux state and retries

`fetchAllContractData` resolves to `{ contracts, meta }`.
On success, `src/redux/slices/contractsSlice.ts`:

- stores each active pool in `contracts` and each archived pool in `deprecatedPools`,
- sums TVL, staked liquidity, volume, and fees over active pools into the `*All` totals,
- stores `meta` as `dataFreshness`,
- sets `hasFetchedData` to `true`, `lastError` to `null`, and `failedAttempts` to `0`.

On failure, it leaves `hasFetchedData` unchanged, so it stays `false` after a failed first load.
It sets `loading` to `false`, stores the error message in `lastError`, and adds one to `failedAttempts`.
Selectors: `dataFreshnessSelector`, `contractsErrorSelector`, and `failedAttemptsSelector`.

`src/components/layout/AppLayout.tsx` retries a failed load with backoff.
It waits 5 seconds after the first failure, 30 seconds after the second, and 2 minutes after the third.
After the fourth failure it stops.
It clears a pending retry on unmount and when the account changes.

The thunk fails only when `getAllContractData` throws.
A failed group does not make it throw. Its pools show `null` values, and the group is missing from `dataFreshness.sources`.

## Pool registry

The backend owns the pool registry. It lives in `lib/pools.json` in the backend repo.
`GET /api/v1/pools` serves it verbatim and needs the same bearer secret.
The registry has two keys:

- `sources` maps `<protocol>:<chain>` to a subgraph id.
- `pools` lists `{ protocol, chain, id, name, active }` for every pool the backend fetches.

The frontend keeps a copy at `src/data/backend-pools.json`. Only the registry test reads it.

`npm run sync:pools` refreshes the copy. It runs `scripts/sync-backend-pools.mjs` with `.env.local`.
It needs `TELX_BACKEND_SECRET_KEY`. It reads `TELX_BACKEND_URL` when set and defaults to `https://api.telx.network`.
It writes the JSON with two-space indentation and a trailing newline, and exits non-zero on any failure.

`src/data/poolRegistry.test.ts` fails when `pool.json` and the registry disagree. It checks three things:

- The Uniswap, Balancer, and QuickSwap pools with `fetchSubgraph: true` in `pool.json` are exactly the registry pools. The key is `protocol:chain:id`. The id is `subgraph_id` for Balancer and `pool_address` for the others.
- Each matching pool has the same `active` value in both files.
- Every DFX entry has `fetchSubgraph: false`.

To add a pool:

1. Add it to `lib/pools.json` in the backend and deploy.
2. Run `npm run sync:pools`.
3. Add the pool to `src/data/pool.json` with `fetchSubgraph: true`.
4. Run `npx jest src/data/poolRegistry.test.ts`.

## Files to consult

- Internal routes: `src/app/api/backend/subgraphs/*-grouped/route.ts`
- Grouped fetch: `src/helpers/fetchGroupedSubgraph.ts`
- Prefetch, cache, and freshness: `src/helpers/prefetchGroupedSubgraph.ts`
- Metric and freshness types: `src/types/PoolMetrics.ts`
- Activity fields and number parsing: `src/helpers/poolMetrics.ts`
- Contract data loader: `src/web3/getContracts/shared.ts`
- Readers: `src/web3/getContracts/{uniswapv4,balancer,quickswap,dfx}/getSingleContractData.ts`
- Balancer on-chain TVL: `src/web3/getContracts/balancer/vault.ts`
- Chart series: `src/components/chart/chart.ts`
- Redux slice: `src/redux/slices/contractsSlice.ts`
- Load and retry: `src/components/layout/AppLayout.tsx`
- Pool config and its normalization: `src/data/pool.json`, `src/helpers/normalizeMiningContracts.ts`
- Registry copy, sync, and test: `src/data/backend-pools.json`, `scripts/sync-backend-pools.mjs`, `src/data/poolRegistry.test.ts`
- Tests for the fetch helpers and the retry: `src/helpers/fetchGroupedSubgraph.test.ts`, `src/components/layout/AppLayout.test.tsx`
