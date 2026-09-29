# Pool Data Pipeline (TELx Frontend)

This document covers how pool data gets from The Graph to the pages.
Pool data means TVL, 24h volume, 24h fees, and the history behind the pool charts.
Scheduled jobs in this app query The Graph, derive per-pool metrics, and cache the result in Upstash Redis.
The pages read that cache through one route and do as little math as they can.
All of it runs in this Next.js app: the pipeline code lives in `src/server/pools/`, and every module there imports `server-only`.

## Writing: the cron jobs

`vercel.json` schedules twelve jobs. Vercel calls each one as `GET /api/cron/<job>` (`src/app/api/cron/[job]/route.ts`).

| Job | Schedule | Cache key |
| --- | --- | --- |
| `uniswap-base-grouped`, `uniswap-polygon-grouped`, `uniswap-ethereum-grouped`, `balancer-grouped` | every 5 minutes | `active-<group>-grouped:hourly:v2` |
| `uniswap-base-history`, `uniswap-polygon-history`, `uniswap-ethereum-history`, `balancer-history` | hourly | `active-<group>-grouped:daily:v2` |
| `quickswap-grouped` | hourly | `active-quickswap-grouped:v2` |
| `merkl-rewards-base`, `merkl-rewards-polygon`, `merkl-rewards-ethereum` | every 10 minutes | `merkl-rewards:<chain>:v1` (see [Rewards (Merkl)](#rewards-merkl)) |

`src/server/pools/jobs.ts` is the allowlist. Any other job name returns 404.

Each job:

1. fetches its group's pools from the subgraph (`src/server/pools/subgraphs/`),
2. validates the result with the zod schemas in `src/server/pools/schemas.ts`,
3. writes the data hash (`fetchedAt`, `indexedAt`, `hasIndexingErrors`, and `data` as a JSON string),
4. updates the status hash `status:<key>` with `lastSuccessAt`, or with `lastError` and `lastErrorAt` on failure.

A failed run leaves the data hash as it was. The route answers with a fixed message (`Cron job failed`, or `Invalid data from subgraph` with status 400). The details go to the function logs and the status hash only.

Hourly jobs keep 48 hours of hourly rows and derive the metrics. History jobs keep 95 days of daily rows. QuickSwap keeps both in one hourly key.

### Authentication

The cron routes accept `GET` only. Every other method returns 405.
Every request needs `Authorization: Bearer ${CRON_SECRET}`, compared in constant time.
There is no bypass for local runs: set `CRON_SECRET` in `.env.local` and send the header.
When `CRON_SECRET` is unset, the routes return 500 and run nothing.

### Missing pools and warnings

A job fails when the subgraph does not return an active pool.
An archived pool (`active: false` in `pool.json`) that the subgraph does not return does not stop the job.
The job writes the pools it has and records a warning in the status hash (`warnings`) and in its response.

### Busy Balancer days

The Balancer hourly job pages through every swap of the last 24 hours, 1,000 per page, up to 20 pages.
When a day has more swaps than that, the job fetches the daily snapshots without swaps instead.
The metrics then interpolate the snapshots (`window: "trailing-24h-interpolated"`), and the job records a warning.

### Health

`GET /api/health` reports the freshness and last cron outcome of each data key, for an external monitor.
It needs `Authorization: Bearer ${HEALTH_CHECK_SECRET}` and returns 500 when that variable is unset.
It returns 200 when every gating key is fresh and not lagging, and 503 otherwise.

- A key is stale when it is missing or older than 15 minutes (5-minute jobs) or 3 hours (hourly jobs).
- A key is lagging when the subgraph block it came from was more than an hour behind the fetch.
- Only keys of groups with an active pool gate the result. Archive-only groups are reported but do not.
- Warnings are reported per key and do not affect the result.

## Reading: from page load to Redux

1. `AppLayout` loads `src/data/pool.json` into the contracts slice with `initializeList`.
2. `AppLayout` dispatches `fetchAllContractData(address)`.
3. The thunk calls `getAllContractData` in `src/web3/getContracts/shared.ts`.
4. `getAllContractData` calls `prefetchGroupedSubgraph`, which calls `fetchGroupedSubgraphs` for the groups the page needs.
5. `fetchGroupedSubgraphs` makes one request to `GET /api/pools`.
6. `/api/pools` (`src/app/api/pools/route.ts`) reads every group from Redis in-process with `readAllGrouped`, in one pipelined request.
7. A protocol reader turns each pool's grouped row into contract data.
8. The slice stores the contract data, the totals, and the data freshness.

### `GET /api/pools`

The route reads every group the registry fetches and returns them together:

```json
{
  "groups": { "uniswap-base": { "fetchedAt": 1758900000000, "...": "..." } },
  "failed": { "balancer": "unavailable" }
}
```

- `groups` maps each group that loaded to its payload (see [Response shape](#response-shape)).
- `failed` maps each group that did not to `"unavailable"` (nothing cached, or only data past its age limit) or `"error"` (the read failed). No error details are included.

A request with any query string gets a `308` redirect to the bare `/api/pools`, with the normal cache header below, and reads nothing from Redis.
The CDN caches by full URL, so a query string would otherwise skip the cache and reach Redis on every request.

Caching:

- When every group loaded, the response carries `Cache-Control: public, s-maxage=30, stale-while-revalidate=300`, so the CDN answers most requests. Each group's `fetchedAt` still says how old the data is.
- A group that is `"unavailable"` (nothing cached yet, or only data past its age limit, for example while its subgraph is failing) does not change the header: its data only changes when its cron next writes, so the normal cache applies.
- When a read fails with `"error"` (a transient cache error), the response carries `Cache-Control: public, s-maxage=10`. It is still cached at the edge, but only for 10 seconds and never served stale, so the next successful read shows up quickly.
- When no group loaded, the status is 503 with `Cache-Control: no-store`.

`/api/market-rate` is cached the same way: status 200 with the same header on success, `no-store` on failure.

### Reading the groups

`readAllGrouped()` in `src/server/pools/groupedRead.ts` reads the hourly and daily key of each split group and the QuickSwap key.
All nine `HGETALL` commands, plus one per Uniswap chain for its Merkl rewards key, go out in one Upstash pipeline, so a request makes one round trip (Upstash still bills every command).
The pipeline keeps errors per command: a group whose command failed is `"error"`, and the other groups still load.
When the request itself fails, every group is `"error"`.

The reads use their own client (`getPoolsReadRedis` in `src/server/pools/redis.ts`), which returns raw field values that `parseSnapshot` parses.
It retries a request that could not connect once, after 100 ms, and gives each request a 4-second deadline across both attempts, so an unreachable Redis becomes `"error"` within seconds.
The cron jobs and the health check use the shared client (`getRedis`), with the same retry and a 30-second deadline, long enough for a large write.

Each group is then built from its keys:

- A split group merges its hourly and daily keys per pool id.
- One part alone is served as it is. The two jobs run on different schedules, so one part can be briefly missing.
- Without the hourly part, every pool carries `metrics: null`, because only the hourly part carries metrics.
- QuickSwap reads its single key, reported as the daily part.
- A part older than its age limit is treated as missing (see below).
- With no fresh key at all, the group is unavailable.

#### Age limits

A failed cron run leaves the previous hash in place, and the hashes have no expiry.
So `readAllGrouped` checks each part's `fetchedAt` against one server clock reading and drops a part past its limit:

| Part | Written | Limit | Past the limit |
| --- | --- | --- | --- |
| Hourly (`:hourly:v2`) | every 5 minutes | 1 hour (12 missed runs) | Dropped, so every pool gets `metrics: null` and shows "Unavailable". Freshness comes from the daily part. |
| Daily (`:daily:v2`) | hourly | 26 hours | Dropped, so the charts get no history. |
| QuickSwap (`active-quickswap-grouped:v2`) | hourly | 3 hours | The group is unavailable. |

A split group with both parts past their limits is unavailable.
The limits are `HOURLY_MAX_AGE_MS`, `DAILY_MAX_AGE_MS` and `QUICKSWAP_MAX_AGE_MS` in `src/server/pools/groupedRead.ts`.

## Response shape

Each group in `/api/pools` is one object:

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
      },
      "rewards": null
    }
  ]
}
```

Top-level fields:

- `fetchedAt` is when the job fetched the subgraph data, in unix milliseconds.
- `indexedAt` is the timestamp of the subgraph's latest indexed block, in unix milliseconds. It is `null` when unknown.
- `hasIndexingErrors` is `true` when a subgraph reported indexing errors.
- `parts` holds the same three fields per cache key. `parts.legacy` is always `false`. The frontend does not read `parts`.
- `data` holds one element per pool in the group, active and archived.

Fields of each `data` element:

- `id` is the lowercase pool id. For Uniswap it is the v4 pool id. For Balancer it is the subgraph pool id. For QuickSwap it is the pair address.
- `pool` is the subgraph pool entity.
- `poolSnapshots` holds recent rows. Uniswap rows are hourly. Balancer and QuickSwap rows are daily.
- `threeMonthLiquidityData` holds the daily history the charts use.
- `swaps` is not stored. The Balancer hourly job uses the swaps only to derive `metrics`.
- `metrics` holds the values the hourly job derived. It is `null` when the hourly part is missing or past its age limit.
- `rewards` (Uniswap only) holds the pool's Merkl rewards, or `null` when none are known. See [Rewards (Merkl)](#rewards-merkl).

### Older payload shapes

`parseGroupedBody` in `src/helpers/fetchGroupedSubgraph.ts` also accepts two older shapes, which `/api/pools` no longer sends:

- An object with fewer fields, such as `{ fetchedAt, data }`. Missing freshness fields become `null`, and pools without `metrics` fall back to the local math described in [Readers](#readers).
- A bare array. All freshness fields are `null`.

For an object with `parts.legacy: true`, the local math applies only while `fetchedAt` is less than `LEGACY_FALLBACK_MAX_AGE_MS` (one hour) old. After that, a missing `metrics` becomes `null`.
With `parts.legacy: false`, as `/api/pools` always sends, a missing `metrics` becomes `null`.

## Fetch helpers

### `fetchGroupedSubgraphs(groups)`

File: `src/helpers/fetchGroupedSubgraph.ts`.

It takes the group names (`SubgraphGroup`) a page needs, such as `"uniswap-base"`, and makes one request to `/api/pools`.
For each requested group it returns either `{ byId, list, meta }` or an `Error`:

- `list` is the `data` array.
- `byId` maps each lowercase pool id to its element.
- `meta` is `{ fetchedAt, indexedAt, hasIndexingErrors }` (`SubgraphMeta`).

A group is an `Error` when `/api/pools` lists it in `failed`, leaves it out, or the request itself fails.
A group the route marks `"unavailable"` is a `GroupUnavailableError`, so callers can tell data the server has aged out from a failed read.
It makes no request when no group is requested.

### `prefetchGroupedSubgraph(contracts, ttlMs?)`

File: `src/helpers/prefetchGroupedSubgraph.ts`.

It fetches a group when at least one pool of that group has `fetchSubgraph: true` in `pool.json`.
All wanted groups load with one call to `fetchGroupedSubgraphs`.
It returns `{ quickswapById, uniswapById, balancerById, meta }`:

- `quickswapById` and `balancerById` are the `byId` maps of their groups.
- `uniswapById` merges the three Uniswap groups. Each key is prefixed with its chain, as in `base:0x727b...`.
- `meta` is a `DataFreshness`, built by `combineSubgraphMeta`.

`DataFreshness` combines the groups that loaded and have at least one pool with `active: true`.
The header totals sum the active pools, so a group fetched only for archived pools does not date them.

- `fetchedAt` and `indexedAt` are the oldest non-null values.
- `hasIndexingErrors` is `true` when any group reports errors, and `null` when no group reports either way.
- `sources` holds each group's own `SubgraphMeta`.
- `failed` lists the groups with an active pool that failed to load. It is absent when none failed.

A group that fails to load is logged, and then:

- When every requested group failed, the call throws. The `fetchAllContractData` thunk rejects, so the slice keeps the data already on screen, `AppLayout` retries with backoff, and the header shows the "could not be loaded" note.
- Otherwise, a group whose read or request failed keeps the data it last loaded in this tab, with that data's own `fetchedAt` in `sources`, so a refetch that hits a transient failure does not replace values already on screen.
- A group the server reports as `"unavailable"` drops any data it loaded before. Its pools get no grouped row, and it is missing from `sources`. A group that failed with nothing loaded before is handled the same way.
- A failed group with an active pool and nothing to show is listed in `failed`, and the header note says its data is unavailable. One that fell back to earlier data is not listed; its age shows through `sources` instead.
- A group without an active pool is still requested for its archived pools, but it never appears in `sources` or `failed`.

`subgraphGroupOf(pool)` returns the group that serves a pool from its `protocol` and `blockchain`, or `null` for DFX.

A result is cached in module memory for 60 seconds only when every requested group loaded. Any other result clears the cache, so a failed group is asked for again on the next call.
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

Type: `PoolMetrics` in `src/types/PoolMetrics.ts`. `src/server/pools/metrics.ts` derives it.

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
| `computedAt` | `number` | The "now" the job used. |

The four time fields in `metrics` are unix seconds.
`fetchedAt` and `indexedAt` are unix milliseconds. Do not mix them up.

### Null versus zero

- `null` means the value is unknown. The job could not derive it, the group failed to load, or the pool has no grouped row.
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
Each reads `metrics` first. It falls back to local math only when `metrics` is missing, which happens only with an older payload shape (see [Older payload shapes](#older-payload-shapes)).

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

- It reads no pool data.
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
A failed group with an active pool is listed in `dataFreshness.failed`.

## Rewards (Merkl)

TELx liquidity rewards run on Merkl. Each Uniswap pool in `/api/pools` carries `rewards`, the reward data Merkl computes for it.
The code lives in `src/server/pools/merkl/` and the type in `src/types/PoolRewards.ts`.

### Source

The `merkl-rewards-<chain>` jobs read `GET https://api.merkl.xyz/v4/opportunities/?chainId=<id>&type=UNISWAP_V4_SUBSCRIPTION` (public, no key), 100 per page until a short page.
They fetch every status (`LIVE`, `SOON`, `PAST`), so a campaign that starts on a chain appears on the first run after Merkl lists it, with no code change.
More than 10 full pages, an HTTP error, or a response that fails validation fails the run.

### Matching

A Merkl opportunity's `identifier` is the low 20 bytes of the 32-byte Uniswap v4 pool id, as a checksummed address.
Each registry Uniswap pool on the chain (active or archived, id from `pool_address`) is matched by `0x` plus the last 40 hex digits of its id, compared in lowercase.
Only opportunities on the job's chain and of type `UNISWAP_V4_SUBSCRIPTION` count. There are no hardcoded opportunity ids.

When several opportunities match one pool:

- `LIVE` ones win. `apr` and `dailyRewards` are summed, and `aprBreakdown` lists every live campaign.
  `subscribedTvlUSD` is the largest reported, since each opportunity measures the same pool's liquidity.
- Without a live one, the next `SOON` campaign (earliest start) is reported, then the most recent `PAST` one (latest end).
- Merkl's `NONE` status and any status it adds later are ignored.

### Fields

`rewards` is `PoolRewards | null`:

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `"LIVE" \| "SOON" \| "PAST"` | Whether a campaign is paying now, is scheduled, or has ended. |
| `apr` | `number \| null` | Rewards APR in percent (`66.9` is 66.9%), summed over the live campaigns. |
| `aprBreakdown` | `{ campaignId, apr, distributionType }[]` | Each live campaign's share of `apr`. |
| `dailyRewards` | `number \| null` | Rewards paid per day, in USD. |
| `subscribedTvlUSD` | `number \| null` | Liquidity subscribed for rewards, in USD. It is not the pool's TVL: for WETH/TEL it was about $92k against $147k on chain. |
| `campaignStart`, `campaignEnd` | `number \| null` | Window of the latest campaign, unix milliseconds. |
| `fetchedAt` | `number` | When the job read Merkl, unix milliseconds. |

The reader copies them onto the Uniswap contract data as `rewardsStatus`, `rewardsApr`, `rewardsDailyRewards`, `subscribedTvlUSD`, `rewardsCampaignStart` and `rewardsCampaignEnd`, each `null` when unknown.
The contract data's existing `rewards` field is the reward token config from `pool.json`, not Merkl data.
Nothing displays these fields yet, and the Staked column does not use `subscribedTvlUSD` yet.

### Null and ended campaigns

- `rewards: null` means no rewards are known: no opportunity matched the pool, the rewards key is missing or past its age limit, or its read failed.
- A `SOON` or `PAST` campaign carries its status and window with `apr`, `dailyRewards` and `subscribedTvlUSD` set to `null` and an empty `aprBreakdown`. An ended campaign never reads as earning, and an unknown rate is never `0`.
- A `LIVE` entry whose `campaignEnd` has passed by the time `/api/pools` reads it is served as `PAST`, so a campaign that ends between two runs stops reading as earning at once.
- Balancer and QuickSwap pools carry no `rewards` field.

### Freshness

Each chain has its own data hash, `merkl-rewards:<chain>:v1`, with `fetchedAt` and `data` (a JSON list of `{ id, rewards }` for the matched pools).
The job runs through the same cron writer as the pool data: a failed run leaves the previous hash in place and records `lastError` on `status:merkl-rewards:<chain>:v1`.
`readAllGrouped` reads the three keys in the same pipeline as the pool data. A key older than 1 hour (`REWARDS_MAX_AGE_MS` in `src/server/pools/merkl/store.ts`, six missed runs) is ignored, so its pools get `rewards: null`.
A failed or stale rewards read never marks a group as failed and never changes the `/api/pools` cache header.
The rewards keys are not part of `/api/health`.

## Rewards (Merkl)

TELx liquidity rewards run on Merkl. Each Uniswap pool in `/api/pools` carries `rewards`, the reward data Merkl computes for it.
The code lives in `src/server/pools/merkl/` and the type in `src/types/PoolRewards.ts`.

### Source

The `merkl-rewards-<chain>` jobs read `GET https://api.merkl.xyz/v4/opportunities/?chainId=<id>&type=UNISWAP_V4_SUBSCRIPTION` (public, no key), 100 per page until a short page.
They fetch every status (`LIVE`, `SOON`, `PAST`), so a campaign that starts on a chain appears on the first run after Merkl lists it, with no code change.
More than 10 full pages, an HTTP error, or a response that fails validation fails the run.

### Matching

A Merkl opportunity's `identifier` is the low 20 bytes of the 32-byte Uniswap v4 pool id, as a checksummed address.
Each registry Uniswap pool on the chain (active or archived, id from `pool_address`) is matched by `0x` plus the last 40 hex digits of its id, compared in lowercase.
Only opportunities on the job's chain and of type `UNISWAP_V4_SUBSCRIPTION` count. There are no hardcoded opportunity ids.

When several opportunities match one pool:

- `LIVE` ones win. `apr` and `dailyRewards` are summed, and `aprBreakdown` lists every live campaign.
  `subscribedTvlUSD` is the largest reported, since each opportunity measures the same pool's liquidity.
- Without a live one, the next `SOON` campaign (earliest start) is reported, then the most recent `PAST` one (latest end).
- Merkl's `NONE` status and any status it adds later are ignored.

### Fields

`rewards` is `PoolRewards | null`:

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `"LIVE" \| "SOON" \| "PAST"` | Whether a campaign is paying now, is scheduled, or has ended. |
| `apr` | `number \| null` | Rewards APR in percent (`66.9` is 66.9%), summed over the live campaigns. |
| `aprBreakdown` | `{ campaignId, apr, distributionType }[]` | Each live campaign's share of `apr`. |
| `dailyRewards` | `number \| null` | Rewards paid per day, in USD. |
| `subscribedTvlUSD` | `number \| null` | Liquidity subscribed for rewards, in USD. It is not the pool's TVL: for WETH/TEL it was about $92k against $147k on chain. |
| `campaignStart`, `campaignEnd` | `number \| null` | Window of the latest campaign, unix milliseconds. |
| `fetchedAt` | `number` | When the job read Merkl, unix milliseconds. |

The reader copies them onto the Uniswap contract data as `rewardsStatus`, `rewardsApr`, `rewardsDailyRewards`, `subscribedTvlUSD`, `rewardsCampaignStart` and `rewardsCampaignEnd`, each `null` when unknown.
The contract data's existing `rewards` field is the reward token config from `pool.json`, not Merkl data.
Nothing displays these fields yet, and the Staked column does not use `subscribedTvlUSD` yet.

### Null and ended campaigns

- `rewards: null` means no rewards are known: no opportunity matched the pool, the rewards key is missing or past its age limit, or its read failed.
- A `SOON` or `PAST` campaign carries its status and window with `apr`, `dailyRewards` and `subscribedTvlUSD` set to `null` and an empty `aprBreakdown`. An ended campaign never reads as earning, and an unknown rate is never `0`.
- A `LIVE` entry whose `campaignEnd` has passed by the time `/api/pools` reads it is served as `PAST`, so a campaign that ends between two runs stops reading as earning at once.
- Balancer and QuickSwap pools carry no `rewards` field.

### Freshness

Each chain has its own data hash, `merkl-rewards:<chain>:v1`, with `fetchedAt` and `data` (a JSON list of `{ id, rewards }` for the matched pools).
The job runs through the same cron writer as the pool data: a failed run leaves the previous hash in place and records `lastError` on `status:merkl-rewards:<chain>:v1`.
`readAllGrouped` reads the three keys in the same pipeline as the pool data. A key older than 1 hour (`REWARDS_MAX_AGE_MS` in `src/server/pools/merkl/store.ts`, six missed runs) is ignored, so its pools get `rewards: null`.
A failed or stale rewards read never marks a group as failed and never changes the `/api/pools` cache header.
The rewards keys are not part of `/api/health`.

## Pool registry

`src/data/pool.json` is the only pool list. The UI reads it, and `src/server/pools/registry.ts` derives the pipeline's registry from it:

- A pool is fetched when it has `fetchSubgraph: true`.
- Its id is `subgraph_id` for Balancer and `pool_address` for Uniswap and QuickSwap, lowercased.
- Its `active` flag decides whether a missing pool fails its job (see [Missing pools and warnings](#missing-pools-and-warnings)) and whether its group gates `/api/health`.
- `SUBGRAPH_SOURCES` in the same file maps each `<protocol>:<chain>` to its subgraph id. It is the one thing `pool.json` does not carry.

`buildRegistry` throws when a pool with `fetchSubgraph: true` has no subgraph source or no id, so a bad edit fails the build.

`src/server/pools/registry.test.ts` pins the fetched pool ids per protocol and chain and the subgraph ids. It also checks that `active` follows `pool.json` and that no DFX pool is fetched.

To add a pool:

1. Add it to `src/data/pool.json` with `fetchSubgraph: true`.
2. Add its id to `EXPECTED_POOL_IDS` in `src/server/pools/registry.test.ts`.
3. Run `npx jest src/server/pools`.

A pool on a new protocol or chain also needs a `SUBGRAPH_SOURCES` entry and a group, job, and schedule.

## Files to consult

- Pool data route: `src/app/api/pools/route.ts`
- Cron and health routes: `src/app/api/cron/[job]/route.ts`, `src/app/api/health/route.ts`, `vercel.json`
- Pipeline: `src/server/pools/` (fetchers in `subgraphs/`, `metrics.ts`, `cache.ts`, `groupedRead.ts`, `cronWrite.ts`, `jobs.ts`, `health.ts`)
- Merkl rewards: `src/server/pools/merkl/` (`fetch.ts`, `match.ts`, `store.ts`), `src/types/PoolRewards.ts`
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
- Registry and its test: `src/server/pools/registry.ts`, `src/server/pools/registry.test.ts`
- Tests for the fetch helpers and the retry: `src/helpers/fetchGroupedSubgraph.test.ts`, `src/components/layout/AppLayout.test.tsx`
- Tests for the pipeline and routes: `src/server/pools/**/*.test.ts`, `src/app/api/{cron/[job],health,pools}/route.test.ts`
