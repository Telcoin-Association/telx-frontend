# Pool Data Pipeline (TELx Frontend)

This document covers how pool data gets from the chain to the pages.
Pool data means TVL, 24h volume, 24h fees, and the history behind the pool charts.
Scheduled jobs in this app compute per-pool metrics for the active Uniswap v4 pools from chain data (PoolManager events, StateView, ReservesLens and Chainlink, read through Alchemy) and cache the result in Upstash Redis.
The pages read that cache through one route and do as little math as they can.
All of it runs in this Next.js app: the pipeline code lives in `src/server/pools/`, and every module there imports `server-only`.

Archived pools (`active: false` in `pool.json`), which includes every Balancer, QuickSwap and DFX pool, have no live figures. Their pool pages say "Archived pool, no live data", and the only chain reads made for them are the connected wallet's stakes and rewards (see [Legacy staking pools](#legacy-staking-pools)).

## Writing: the cron jobs

`vercel.json` schedules six jobs. Vercel calls each one as `GET /api/cron/<job>` (`src/app/api/cron/[job]/route.ts`).

| Job | Schedule | Cache key |
| --- | --- | --- |
| `uniswap-polygon-rpc`, `uniswap-base-rpc`, `uniswap-ethereum-rpc` | every 5 minutes | `active-uniswap-<chain>-grouped:v3` (see [Uniswap v4 from chain data](#uniswap-v4-from-chain-data)) |
| `merkl-rewards-base`, `merkl-rewards-polygon`, `merkl-rewards-ethereum` | every 5 minutes | `merkl-rewards:<chain>:v1` (see [Rewards (Merkl)](#rewards-merkl)) |

`src/server/pools/jobs.ts` is the allowlist. Any other job name returns 404.

Every job writes through `runCronWrite` (`src/server/pools/cronWrite.ts`), which:

1. validates the payload with the zod schemas in `src/server/pools/schemas.ts` (the Merkl jobs bring their own),
2. writes the data hash (`fetchedAt`, `indexedAt`, `hasIndexingErrors`, and `data` as a JSON string),
3. updates the status hash `status:<key>`: on success `lastSuccessAt` and the run's warnings, cleared of any earlier error in one transaction; on failure `lastError` and `lastErrorAt`.

A failed run leaves the data hash as it was. The route answers with a fixed message (`Cron job failed`, or `Invalid data from source` with status 400). The details go to the function logs and the status hash only.

### Authentication

The cron routes accept `GET` only. Every other method returns 405.
Every request needs `Authorization: Bearer ${CRON_SECRET}`, compared in constant time.
There is no bypass for local runs: set `CRON_SECRET` in `.env.local` and send the header.
When `CRON_SECRET` is unset, the routes return 500 and run nothing.

### Health

`GET /api/health` reports the freshness and last cron outcome of each chain's pool data key, for an external monitor.
It needs `Authorization: Bearer ${HEALTH_CHECK_SECRET}` and returns 500 when that variable is unset.
It returns 200 when every gating key is fresh and not lagging, and 503 otherwise.

- A key is stale when it is missing or older than 15 minutes (three missed runs).
- A key is lagging when the block it came from was more than its chain's limit behind the fetch: 600 seconds on Polygon, 2,700 on Ethereum and 3,600 on Base, measured from the block the pipeline reads up to (see below).
- Only chains with an active pool gate the result. A chain with only archived pools is reported but does not.
- The status carries `lastRun`: the block range of the last run, its chunks, logs, calls, compute units and duration. Its `toBlock` is the chain's cursor.
- Warnings are reported per key and do not affect the result.

## Uniswap v4 from chain data

`src/server/pools/rpc/` computes each chain's payload from chain data for its active Uniswap pools, through the app's server-side Alchemy key (`ALCHEMY_ID`, on the Pay As You Go plan, sending `NEXT_PUBLIC_ORIGIN` as `Origin`).

### What each run does

Every 5 minutes `uniswap-<chain>-rpc`:

1. takes the chain's lock (`rpc:<chain>:lock`, 240 seconds); a run that finds it held answers 200 `skipped`,
2. reads the cursor (`rpc:<chain>:cursor`); without one, or when the active pools differ from the ones the backfill covered, the run fails and records why,
3. makes one Multicall3 `eth_call` at the chain's head tag block (`safe` on Base and Ethereum, `finalized` on Polygon): the block and its time, Chainlink ETH/USD (and MXN/USD on Polygon), and per pool ReservesLens `getPoolTVL`, StateView `getSlot0` and `getLiquidity`,
4. makes one `eth_getLogs` for Swap and ModifyLiquidity of the pools from the cursor to the head tag block (at most 12 hours of blocks per chunk, up to 4 chunks or 120 seconds per run),
5. prices the swaps, adds them to 5-minute buckets and UTC day rows, applies liquidity changes to the per-range liquidity map, records each PositionManager liquidity change under its token id, and writes the chunk and the new cursor in one `MULTI`/`EXEC`,
6. builds the payload and writes it through `runCronWrite`, which validates it and keeps `status:active-uniswap-<chain>-grouped:v3`.

Base and Ethereum are read to their `safe` block, which trails the head by about a minute on Base (its batch is posted to Ethereum) and about 13 minutes on Ethereum. Their `finalized` block trails by 15 to 45 minutes on Base, moving in jumps as Ethereum finalizes Base's batches. A `safe` block changes only if Ethereum reorganizes before finalizing; the pipeline does not rewind for that, so such a block's events stay in the totals. Polygon has no `safe` block and is read to its `finalized` block, which trails by seconds. The backfill reads to the `finalized` block on every chain. `indexedAt` is the time of the block read to.

### Keys

| Key | Content | Kept |
| --- | --- | --- |
| `rpc:<chain>:cursor` | last block folded in, its time, and the pool ids the backfill covered | always |
| `rpc:<chain>:b5m:<poolId>` | 5-minute buckets: swaps, volume, fees, LP and protocol fees | 48 hours |
| `rpc:<chain>:day:<poolId>` | UTC day rows: swaps, volume, fees, and at the day's last run the TVL, closing `sqrtPriceX96` and tick, and the USD prices of both currencies (rows written before these fields existed lack them) | 95 days |
| `rpc:<chain>:liq:<poolId>` | net liquidity per `tickLower:tickUpper` since the pool's creation | always |
| `rpc:<chain>:pos:<poolId>` | one field per PositionManager `ModifyLiquidity`, `tokenId:block:logIndex` to `{ t, tickLower, tickUpper, d }` (time, range and signed liquidity delta). The token id is the event's salt; changes by other contracts are not recorded. Written only, never read by the cron | always |
| `rpc:<chain>:state` | block, prices, and per pool slot0, reserves, TVL, last activity and fee totals | latest |
| `rpc:<chain>:backfill` | backfill progress | until done |
| `active-uniswap-<chain>-grouped:v3` | the payload, as a data hash | latest |

### Metrics from chain data

- Volume is the absolute amount of the pool's anchor currency (`anchor` in `pool.json`: WETH/ETH or eUSD) at its price.
- Fees are the swap's input times the Swap event's fee (LP plus protocol, e.g. 3499 pips for the 0.30% pools) at the input's price at the swap; buckets also keep the LP and protocol shares, split with slot0's `protocolFee`.
- TVL is the pool's reserves from ReservesLens times prices, falling back to the position sum when the lens call fails. Neither counts fees LPs have not collected. A pool that cannot be valued has `tvlUSD: null`.
- `volume24h` and `fees24h` sum the 5-minute buckets of the trailing 24 hours to the head tag block, so the window is exact to 5 minutes. They are null when the data trails the chain or the clock by more than the chain's lag limit.
- `rows24h` counts swaps. `lastSwapAt` and `lastActivityAt` are the newest Swap, and the newest Swap or ModifyLiquidity. `createdAt` is the pool's creation block time. `pool.feesUSD` counts fees since the backfill started.
- `poolSnapshots` has 48 hourly rows, one for every hour (quiet hours are zero), and `threeMonthLiquidityData` one row for every UTC day since creation, up to 95, both newest first.

### Prices

- ETH (native on Base and Ethereum, WETH on Polygon) and eMXN (as 1 MXN) come from Chainlink on the same chain. An answer at or below zero, or older than the feed's heartbeat plus 10 minutes, gives way to the last stored price, flagged.
- eUSD is fixed at $1. Polygon runs record the eUSD price implied by the eUSD/eMXN pool and MXN/USD, and warn past 3% off.
- TEL is the median of the pool routes (each TEL pool's price times the other token's price) whose other side holds at least $5,000; a move over 20% from the last stored price is clamped. Without a usable route a chain takes Polygon's TEL price (if Polygon's state is at most an hour old), then Merkl's, then its own last price, then the thin routes, each flagged. Merkl's price is otherwise a cross-check that warns past 10%.
- Warnings go to the status hash and never fail a run. A token left with no price at all fails the run, so a guess is never published.

### Backfill runbook

A chain has no cursor until its backfill has run. `POST /api/admin/rpc-backfill/<chain>` needs `Authorization: Bearer ${CRON_SECRET}` (the preview login does not apply to `/api/admin/`), works for up to 150 seconds per call, and answers `{ done, nextBlock, finalizedBlock, chunks, warnings }`. It walks from the chain's earliest pool creation block to the finalized block in one-hour chunks, prices each chunk with an archive bundle at its end block, uses the position sum for TVL, and writes the cursor when it gets there; from then on the cron takes over.

Run Polygon first, since Base and Ethereum fall back to Polygon's TEL price:

```sh
HOST=https://www.telx.network
for chain in polygon base ethereum; do
  until curl -sf -X POST -H "Authorization: Bearer $CRON_SECRET" "$HOST/api/admin/rpc-backfill/$chain" | tee /dev/stderr | grep -q '"done":true'; do sleep 2; done
done
```

- A call made while the cron holds the chain's lock answers 409; the loop simply tries again.
- For the current pools (created on 2026-09-23) each chain takes about 140 chunks: two or three calls and about 12,000 compute units per chain. A pool that is 95 days old takes about 2,300 chunks and 200,000 compute units.
- `?reset=1` deletes the chain's `rpc:` keys and its payload and starts again. Send it on the first call only: every call that carries it starts over, so a loop that keeps it never finishes. A pool added to or removed from the active set in `pool.json` needs such a reset: until then the chain's cron fails with "backfill needed".

To check a chain: `GET /api/health` shows `active-uniswap-<chain>-grouped:v3` fresh and not lagging, with `lastRun` advancing, and `/api/pools` serves the group with `fetchedAt` within the last 5 minutes.

## Reading: from page load to Redux

1. `AppLayout` loads `src/data/pool.json` into the contracts slice with `initializeList`.
2. `AppLayout` dispatches `fetchAllContractData(address)`, and `usePoolDataRefresh` repeats it in the background while the tab stays open (see [Redux state, retries and refresh](#redux-state-retries-and-refresh)).
3. The thunk calls `getAllContractData` in `src/web3/getContracts/shared.ts`.
4. `getAllContractData` calls `prefetchPoolData`, which calls `fetchPoolGroups` for the chains whose Uniswap pools the page lists.
5. `fetchPoolGroups` makes one request to `GET /api/pools`.
6. `/api/pools` (`src/app/api/pools/route.ts`) reads every group from Redis in-process with `readAllGrouped`, in one pipelined request.
7. A protocol reader turns each pool's grouped row, or for legacy pools the wallet's chain reads, into contract data.
8. The slice stores the contract data, the totals, and the data freshness.

### `GET /api/pools`

The route reads every chain's group and returns them together:

```json
{
  "groups": { "uniswap-polygon": { "fetchedAt": 1758900000000, "...": "..." } },
  "failed": { "uniswap-base": "unavailable" }
}
```

- `groups` maps each group that loaded to its payload (see [Response shape](#response-shape)).
- `failed` maps each group that did not to `"unavailable"` (nothing cached, or only data past its age limit) or `"error"` (the read failed). No error details are included.

A request with any query string gets a `308` redirect to the bare `/api/pools`, with the normal cache header below, and reads nothing from Redis.
The CDN caches by full URL, so a query string would otherwise skip the cache and reach Redis on every request.

Caching:

- When every group loaded, the response carries `Cache-Control: public, s-maxage=30, stale-while-revalidate=300`, so the CDN answers most requests. Each group's `fetchedAt` still says how old the data is.
- A group that is `"unavailable"` does not change the header: its data only changes when its cron next writes, so the normal cache applies.
- When a read fails with `"error"` (a transient cache error), or a loaded group's Merkl rewards are unknown (`rewardsUnavailable`), the response carries `Cache-Control: public, s-maxage=10`. It is still cached at the edge, but only for 10 seconds and never served stale, so the next successful read shows up quickly.
- When no group loaded, the status is 503 with `Cache-Control: no-store`.

`/api/market-rate` is cached the same way: status 200 with the same header on success, `no-store` on failure.

### Reading the groups

`readAllGrouped()` in `src/server/pools/groupedRead.ts` reads each chain's `active-uniswap-<chain>-grouped:v3` key and its Merkl rewards key, six `HGETALL` commands in one Upstash pipeline, so a request makes one round trip (Upstash still bills every command).
The pipeline keeps errors per command: a group whose command failed is `"error"`, and the other groups still load.
When the request itself fails, every group is `"error"`.

The reads use their own client (`getPoolsReadRedis` in `src/server/pools/redis.ts`), which returns raw field values that `parseSnapshot` parses.
It retries a request that could not connect once, after 100 ms, and gives each request a 4-second deadline across both attempts, so an unreachable Redis becomes `"error"` within seconds.
The cron jobs and the health check use the shared client (`getRedis`), with the same retry and a 30-second deadline, long enough for a large write.

#### Age limits

A failed cron run leaves the previous hash in place, and the hashes have no expiry.
So `readAllGrouped` checks each key's `fetchedAt` against one server clock reading:

- A key older than an hour (`V3_MAX_AGE_MS`, 12 missed runs) is treated as missing, and its group is unavailable.
- When a key's `indexedAt` (the time of the block it was computed at) trails the clock by more than the chain's lag limit plus 15 minutes (`v3WindowMaxLagMs`), its `volume24h`, `fees24h` and `window` are served as null, while TVL and the chart rows are still served until the age limit.

## Response shape

Each group in `/api/pools` is one object:

```json
{
  "fetchedAt": 1758900000000,
  "indexedAt": 1758899990000,
  "hasIndexingErrors": false,
  "parts": {
    "hourly": { "fetchedAt": 1758900000000, "indexedAt": 1758899990000, "hasIndexingErrors": false },
    "daily": { "fetchedAt": 1758900000000, "indexedAt": 1758899990000, "hasIndexingErrors": false },
    "legacy": false
  },
  "data": [
    {
      "id": "0xa22a...de0d",
      "pool": { "id": "0xa22a...de0d", "totalValueLockedUSD": 147120.75, "feesUSD": 755.56, "createdAtTimestamp": 1790201522 },
      "poolSnapshots": [],
      "threeMonthLiquidityData": [],
      "metrics": {
        "tvlUSD": 147120.75, "volume24h": 319800.97, "fees24h": 1117.89, "window": "trailing-24h",
        "lastActivityAt": 1790703567, "lastSwapAt": 1790703356, "createdAt": 1790201522,
        "rows24h": 2107, "computedAt": 1790703600
      },
      "rewards": null
    }
  ]
}
```

Top-level fields:

- `fetchedAt` is when the job wrote the payload, in unix milliseconds.
- `indexedAt` is the time of the block the payload was computed at (the chain's head tag block), in unix milliseconds. It is `null` when unknown.
- `hasIndexingErrors` is always `false` for chain data. It stays in the shape the client parses.
- `parts` holds the same three fields for the hourly and daily rows, which one key carries together, so both are the key's own. `parts.legacy` is always `false`. The frontend does not read `parts`.
- `data` holds one element per active pool of the chain.

Fields of each `data` element:

- `id` is the lowercase Uniswap v4 pool id.
- `pool` holds the pool's TVL, fees since the backfill, and creation time.
- `poolSnapshots` holds the last 48 hourly rows.
- `threeMonthLiquidityData` holds the daily history the charts use.
- `metrics` holds the values the job derived (see [Metrics](#metrics)).
- `rewards` holds the pool's Merkl rewards, or `null` when no campaign matched the pool. It is absent when the rewards are unknown, and the group then carries `rewardsUnavailable: true`. See [Rewards (Merkl)](#rewards-merkl).

### Older payload shapes

`parseGroupedBody` in `src/helpers/fetchPoolData.ts` also accepts two older shapes, which `/api/pools` no longer sends:

- An object with fewer fields, such as `{ fetchedAt, data }`. Missing freshness fields become `null`, and pools without `metrics` fall back to the local math described in [Readers](#readers).
- A bare array. All freshness fields are `null`.

For an object with `parts.legacy: true`, the local math applies only while `fetchedAt` is less than `LEGACY_FALLBACK_MAX_AGE_MS` (one hour) old. After that, a missing `metrics` becomes `null`.
With `parts.legacy: false`, as `/api/pools` always sends, a missing `metrics` becomes `null`.

## Fetch helpers

### `fetchPoolGroups(groups)`

File: `src/helpers/fetchPoolData.ts`.

It takes the group names (`PoolGroup`) a page needs, such as `"uniswap-base"`, and makes one request to `/api/pools`.
For each requested group it returns either `{ byId, list, meta }` or an `Error`:

- `list` is the `data` array.
- `byId` maps each lowercase pool id to its element.
- `meta` is `{ fetchedAt, indexedAt, hasIndexingErrors }` (`PoolDataMeta`).

A group is an `Error` when `/api/pools` lists it in `failed`, leaves it out, or the request itself fails.
A group the route marks `"unavailable"` is a `GroupUnavailableError`, so callers can tell data the server has aged out from a failed read.
It makes no request when no group is requested.

### `prefetchPoolData(contracts, ttlMs?)`

File: `src/helpers/prefetchPoolData.ts`.

It requests a chain's group when the page lists at least one Uniswap pool on it (`poolGroupOf`), and no group for any other protocol.
All wanted groups load with one call to `fetchPoolGroups`.
It returns `{ uniswapById, meta }`:

- `uniswapById` merges the three groups. Each key is prefixed with its chain, as in `polygon:0xa22a...`.
- `meta` is a `DataFreshness`, built by `combinePoolDataMeta`.

`DataFreshness` combines the groups that loaded and have at least one pool with `active: true`.
The header totals sum the active pools, so a chain with only archived pools does not date them.

- `fetchedAt` and `indexedAt` are the oldest non-null values.
- `hasIndexingErrors` is `true` when any group reports errors, and `null` when no group reports either way.
- `sources` holds each group's own `PoolDataMeta`.
- `failed` lists the groups with an active pool that failed to load. It is absent when none failed.

A group that fails to load is logged, and then:

- When every requested group failed, the call throws. The `fetchAllContractData` thunk rejects, so the slice keeps the data already on screen, `AppLayout` retries with backoff, and the header shows the "could not be loaded" note.
- Otherwise, a group whose read or request failed keeps the data it last loaded in this tab, with that data's own `fetchedAt` in `sources`, so a refetch that hits a transient failure does not replace values already on screen.
- A group the server reports as `"unavailable"` drops any data it loaded before. Its pools get no grouped row, and it is missing from `sources`. A group that failed with nothing loaded before is handled the same way.
- A failed group with an active pool and nothing to show is listed in `failed`, and the header note says its data is unavailable. One that fell back to earlier data is not listed; its age shows through `sources` instead.

A result is cached in module memory for 60 seconds only when every requested group loaded. Any other result clears the cache, so a failed group is asked for again on the next call.
Concurrent calls with the same pool list share one request.

`getAllContractData` finds a Uniswap pool's row by `<blockchain>:<pool id, lowercase>` in `uniswapById`. Balancer, QuickSwap and DFX pools have no grouped row.

## Metrics

Type: `PoolMetrics` in `src/types/PoolMetrics.ts`. `src/server/pools/rpc/payload.ts` derives it.

| Field | Type | Meaning |
| --- | --- | --- |
| `tvlUSD` | `number \| null` | Pool TVL in USD, from chain data. |
| `volume24h` | `number \| null` | Volume in USD over `window`. |
| `fees24h` | `number \| null` | Fees in USD over `window`. |
| `window` | `"trailing-24h" \| null` | The trailing 24 hours to the head tag block; `null` when the 24h values are withheld. |
| `lastActivityAt` | `number \| null` | Newest Swap or ModifyLiquidity. |
| `lastSwapAt` | `number \| null` | Newest Swap. |
| `createdAt` | `number \| null` | The pool's creation block time. |
| `rows24h` | `number` | Swaps inside the window. |
| `computedAt` | `number` | The "now" the job used. |

The four time fields in `metrics` are unix seconds.
`fetchedAt` and `indexedAt` are unix milliseconds. Do not mix them up.

### Null versus zero

- `null` means the value is unknown. The job could not derive it, the group failed to load, or the pool has no grouped row.
- `0` means the pool had no swaps in the window.

Show `null` as unavailable. Show `0` as a value.
The slice counts `null` as `0` when it sums the totals.

## Readers

Each reader lives in `src/web3/getContracts/<protocol>/getSingleContractData.ts`.

`uniswapGetSingleContractData` (folder `uniswapv4`):

- With `metrics`: `totalLiquidity`, `dailyVolumeUSD`, and `fees24hr` come from `tvlUSD`, `volume24h`, and `fees24h`.
- With `metrics: null`: TVL is `pool.totalValueLockedUSD`, and volume and fees are unknown.
- Without `metrics` (an older payload shape): TVL is `pool.totalValueLockedUSD`. Volume and fees sum the `poolSnapshots` rows from the last 24 hours. No rows gives `0`.
- Without a grouped row, as for an archived pool: all three are `null`.
- With `metrics`, it copies four more fields onto the contract data with `activityFields` from `src/helpers/poolMetrics.ts`: `volume24hWindow` (from `window`), `lastActivityAt`, `lastSwapAt`, and `createdAt`.
- The chart arrays (`liquidityChartData`, `volumeChartData`) come from `threeMonthLiquidityData`. `src/components/chart/chart.ts` turns them into chart series.

### Legacy staking pools

`balancerGetSingleContractData`, `quickswapGetSingleContractData` and `dfxGetSingleContractData` read staking contracts on chain through `readStakeState` (`src/web3/getContracts/all/readStakeState.ts`):

- The connected wallet's LP balance, its stake in each staking contract (current and retired) and its unclaimed rewards (`earned*`) are read whenever a wallet is connected, so Portfolio keeps listing a stake, or rewards left after an unstake, until they are withdrawn and claimed.
- The pool-wide totals (LP supply, the staking contract's LP balance and total stake) are read only for an active pool or when the wallet has a stake to value. An inactive pool costs no read without a wallet.
- A Balancer pool's TVL is priced from the Vault's balances (`src/web3/getContracts/balancer/vault.ts`) by its pool id, which `pool.json` keeps in `subgraph_id`, and only when needed: for an active pool, or to value a wallet's stake. Token prices come from `/api/market-rate` and are fetched only then.
- There is no source for these pools' volume, fees or history, which read as unknown, or for a QuickSwap or DFX pool's TVL.

## Redux state, retries and refresh

`fetchAllContractData` resolves to `{ contracts, meta }`.
On success, `src/redux/slices/contractsSlice.ts`:

- stores each active pool in `contracts`, each archived pool in `deprecatedPools`, and each pool the wallet holds a stake or rewards in (`hasUserHoldings`) in `userContracts`,
- sums TVL, subscribed liquidity, volume, and fees over active pools into the `*All` totals,
- stores `meta` as `dataFreshness` and the load time as `loadedAt`,
- sets `hasFetchedData` to `true`, `lastError` to `null`, and `failedAttempts` to `0`.

On failure, it leaves `hasFetchedData` unchanged, so it stays `false` after a failed first load.
It sets `loading` to `false`, stores the error message in `lastError`, and adds one to `failedAttempts`.
Selectors: `dataFreshnessSelector`, `contractsErrorSelector`, `failedAttemptsSelector`, and `loadedAtSelector`.

`src/components/layout/AppLayout.tsx` retries a failed load with backoff.
It waits 5 seconds after the first failure, 30 seconds after the second, and 2 minutes after the third.
After the fourth failure it stops.
It clears a pending retry on unmount and when the account changes.

`usePoolDataRefresh` (`src/hooks/usePoolDataRefresh.ts`) keeps an open tab current: while the tab is visible, data older than 5 minutes reloads in the background, and a hidden tab that becomes visible again refreshes at once if it is due. A background load (`fetchAllContractData({ address, background: true })`) shows no spinner, and when it fails it keeps the data on screen with no error; the next check tries again an interval later.

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

`rewards` is `PoolRewards | null`, or absent when unknown:

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `"LIVE" \| "SOON" \| "PAST"` | Whether a campaign is paying now, is scheduled, or has ended. |
| `apr` | `number \| null` | Rewards APR in percent (`66.9` is 66.9%), summed over the live campaigns. |
| `aprBreakdown` | `{ campaignId, apr, distributionType }[]` | Each live campaign's share of `apr`. |
| `dailyRewards` | `number \| null` | Rewards paid per day, in USD. |
| `subscribedTvlUSD` | `number \| null` | Liquidity subscribed for rewards, in USD. It is not the pool's TVL: for WETH/TEL it was about $92k against $147k on chain. |
| `campaignStart`, `campaignEnd` | `number \| null` | Window of the latest campaign, unix milliseconds. A value no date can hold (a time Merkl sent in the wrong unit) is `null`. |
| `fetchedAt` | `number` | When the job read Merkl, unix milliseconds. |

The reader copies them onto the Uniswap contract data as `rewardsStatus`, `rewardsApr`, `rewardsDailyRewards`, `subscribedTvlUSD`, `rewardsCampaignStart` and `rewardsCampaignEnd`, each `null` when unknown, with `rewardsKnown` false when the rewards themselves are unknown.
The contract data's existing `rewards` field is the reward token config from `pool.json`, not Merkl data.
The pages show them as Subscribed Value Locked (per pool and summed in the header) and as the subscribed APR with its campaign window. Campaign dates are shown as UTC days, since campaigns start and end at 00:00 UTC.

### Null and ended campaigns

- `rewards: null` means no opportunity matched the pool.
- No `rewards` field, with `rewardsUnavailable: true` on the group, means the rewards are unknown: the rewards key is missing or past its age limit, or its read failed. The pages show the pool's Subscribed Value Locked as "Unavailable" and mark the header total partial, and an open tab keeps the rewards it loaded earlier.
- A `SOON` or `PAST` campaign carries its status and window with `apr`, `dailyRewards` and `subscribedTvlUSD` set to `null` and an empty `aprBreakdown`. An ended campaign never reads as earning, and an unknown rate is never `0`.
- A `LIVE` entry whose `campaignEnd` has passed by the time `/api/pools` reads it is served as `PAST`, so a campaign that ends between two runs stops reading as earning at once. The pages apply the same rule against the clock, so a campaign that ends while a tab is open stops reading as earning within a minute.

### Freshness

Each chain has its own data hash, `merkl-rewards:<chain>:v1`, with `fetchedAt` and `data` (a JSON list of `{ id, rewards }` for the matched pools).
The job runs through the same cron writer as the pool data: a failed run leaves the previous hash in place and records `lastError` on `status:merkl-rewards:<chain>:v1`.
`readAllGrouped` reads the three keys in the same pipeline as the pool data. A key older than 1 hour (`REWARDS_MAX_AGE_MS` in `src/server/pools/merkl/store.ts`, six missed runs) is ignored, so its chain's rewards are unknown.
A failed or stale rewards read never marks a group as failed. It marks the group `rewardsUnavailable` and shortens the `/api/pools` cache to 10 seconds.
The rewards keys are not part of `/api/health`.

## Pool registry

`src/data/pool.json` is the only pool list. The UI reads it, and `src/server/pools/registry.ts` derives the pipeline's registry from its Uniswap entries:

- Its id is `pool_address`, lowercased.
- An active pool needs its `key`, `anchor` and `createdBlock`, which the RPC pipeline reads; `buildRegistry` throws without them, so a bad edit fails the build.
- Its `active` flag decides whether the RPC pipeline reads it and whether its chain gates `/api/health`. Archived pools stay listed so that Merkl rewards resolve for them.

`src/server/pools/registry.test.ts` pins the pool ids per chain, checks that each pool key hashes to its id, that every currency has a price rule, and that `active` follows `pool.json`.

To add a Uniswap pool:

1. Add it to `src/data/pool.json` with its `key`, `anchor`, `createdBlock` and `decimals`.
2. Add its id to `EXPECTED_POOL_IDS` in `src/server/pools/registry.test.ts`.
3. Run `npx jest src/server/pools`.
4. Reset and rerun the chain's backfill (see [Backfill runbook](#backfill-runbook)).

## Files to consult

- Pool data route: `src/app/api/pools/route.ts`
- Cron and health routes: `src/app/api/cron/[job]/route.ts`, `src/app/api/health/route.ts`, `vercel.json`
- Pipeline: `src/server/pools/` (`rpc/`, `cache.ts`, `groupedRead.ts`, `cronWrite.ts`, `jobs.ts`, `health.ts`, `schemas.ts`)
- Merkl rewards: `src/server/pools/merkl/` (`fetch.ts`, `match.ts`, `store.ts`), `src/types/PoolRewards.ts`
- Grouped fetch: `src/helpers/fetchPoolData.ts`
- Prefetch, cache, and freshness: `src/helpers/prefetchPoolData.ts`
- Metric and freshness types: `src/types/PoolMetrics.ts`
- Activity fields and number parsing: `src/helpers/poolMetrics.ts`
- Contract data loader: `src/web3/getContracts/shared.ts`
- Readers: `src/web3/getContracts/{uniswapv4,balancer,quickswap,dfx}/getSingleContractData.ts`
- Legacy staking reads: `src/web3/getContracts/all/readStakeState.ts`, Balancer on-chain TVL: `src/web3/getContracts/balancer/vault.ts`
- Chart series: `src/components/chart/chart.ts`
- Redux slice: `src/redux/slices/contractsSlice.ts`
- Load, retry and refresh: `src/components/layout/AppLayout.tsx`, `src/hooks/usePoolDataRefresh.ts`
- Pool config and its normalization: `src/data/pool.json`, `src/helpers/normalizeMiningContracts.ts`
- Registry and its test: `src/server/pools/registry.ts`, `src/server/pools/registry.test.ts`
- Tests for the fetch helpers and the retry: `src/helpers/fetchPoolData.test.ts`, `src/components/layout/AppLayout.test.tsx`
- Tests for the pipeline and routes: `src/server/pools/**/*.test.ts`, `src/app/api/{cron/[job],health,pools}/route.test.ts`
