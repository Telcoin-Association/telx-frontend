# Plan: Uniswap v4 pool statistics from Alchemy RPC

Goal: compute TVL, 24h volume, 24h fees and chart history for the active Uniswap v4 pools on Polygon PoS, Base and Ethereum from Alchemy RPC alone, and drop every dependency on The Graph from both repositories: the gateway, `GRAPH_STUDIO_KEY`, the subgraph ids, `@apollo/client` and `graphql`.
The pipeline runs in this repository on top of PR #52 (placement A, recommended) or in telx-backend (B); the per-group payload keeps its shape.
Effort: about 7.5 engineering days plus one calendar day of parallel running, after phase 0.

## Background

### What breaks today

Crons copy pool data from The Graph into the Upstash store (Vercel KV), and the frontend sums the active pools into the header stats.
Uniswap's Polygon v4 subgraph crashed at block 94,494,304 on 2026-09-26 on a `handleSwap` null bug that Uniswap fixed in 2025 but never redeployed.
The gateway refuses every Polygon query, so the three active Polygon pools (WETH/TEL, eUSD/TEL, eUSD/eMXN) have no data; production serves a frozen `:v1` entry from 2026-09-21 holding only retired TEL2 pools.
The Ethereum subgraph has the same bug and answers only because one indexer pruned the bad block.

Healthy subgraphs are wrong too.
Their token whitelists lack TEL, eUSD and eMXN, so eUSD/TEL and eUSD/eMXN show zero volume and fees on every chain and near-zero TVL on Base and Ethereum.
Their TVL never subtracts collected fees and drifts upward (1.5% high for Polygon WETH/TEL after five days).
Few indexers serve them (two on Polygon, one on Base).
None of this can be fixed in our code; see `report-uniswap-subgraph.md`.

### Numbers to reproduce

Measured from PoolManager logs and StateView for the 24 hours to 2026-09-28 18:00 UTC (Polygon blocks 94,560,737 to 94,618,337), with Chainlink ETH at $2,673.02 and MXN/USD at 0.0556951, eUSD at $1, and TEL at $0.0024597 (eUSD route) and $0.0024617 (WETH route):

| Pool | Swaps | Volume | Fees (LP + protocol) | TVL (position sum) |
| --- | --- | --- | --- | --- |
| WETH/TEL `0xa22a3fb3` | 1,310 | $215,853 | $755.29 ($647.36 + $107.93) | $146,959 |
| eUSD/TEL `0x1266df87` | 358 | $40,905 | $143.06 ($122.61 + $20.44) | $48,505 |
| eUSD/eMXN `0xe604df8f` | 227 | $981 | $0.61 ($0.49 LP) | $45,741 |

The eUSD/eMXN TVL priced eMXN at the pool rate (17.719 per eUSD); at the Chainlink rate this plan uses (17.955) the same reserves are worth about $45,457.
GeckoTerminal agreed within 2% on every figure except eUSD/TEL TVL ($56.8k, 17% higher, cause unknown).
Base and Ethereum have no measured numbers; the parallel run compares them with GeckoTerminal and the v2 payloads.

### Cost budget

Each run makes one `eth_call` (26 CU) and one `eth_getLogs` (60 CU) per chain: 258 CU for three chains.
Every 5 minutes that is 8,640 runs and about 2.23M CU a month, $1.17 on Pay As You Go at $0.525 per 1M CU.
The one-off backfill stays under 500,000 CU.
Pay As You Go is required: the Free plan caps `eth_getLogs` at 10 blocks on all three chains.

## Cross-reference with PR #52

Telcoin-Association/telx-frontend#52 ("Move the pool data pipeline into this app and serve pool data from one cached route", branch `feat/pool-pipeline-port`, open and unreviewed) ports the telx-backend pipeline into `src/server/pools/`, with `@upstash/redis` in place of the deprecated `@vercel/kv` (same store, same keys).
It adds `GET /api/pools`, which returns every group as `{ groups, failed }`, `GET /api/cron/[job]` for nine jobs in a new `vercel.json` behind `CRON_SECRET`, and `GET /api/health` behind `HEALTH_CHECK_SECRET`.
It deletes the five `/api/backend/subgraphs/*-grouped` proxies, `src/data/backend-pools.json` and `src/data/poolRegistry.test.ts`, derives the registry from `src/data/pool.json`, and drops the `:v1` fallback, so Polygon shows as unavailable.
The Graph stays its only source.
It conflicts with `fix/header-stats-freshness` in three files (details in `tasks/pr-52-summary.md`).

### Placement

- (A) This repository, under `src/server/pools/` on top of PR 52: the RPC jobs replace the ported Graph fetchers and write through PR 52's cache, cron route and health.
- (B) telx-backend, as the first draft assumed.

Recommendation: (A), if PR 52 is going to merge.
One repository, one deploy and one test runner (jest) cover the fetch, the cache and the pages.
The pipeline is already moving here and PR 52 retires telx-backend (#45); (B) would build on a project about to be archived and, with PR 52 merged, need the v3 read in both repositories.
No secret crosses projects: `ALCHEMY_API_KEY` sits beside `ALCHEMY_ID` in one Vercel project, where (B) keeps KV credentials or `TELX_BACKEND_SECRET_KEY` in two.
Afterwards, archive telx-backend.
Nothing under (A) reads it and the freeze reads the shared store, so keeping it for the frozen archived-pool data gains nothing.

### What (A) takes from PR 52

- Reused unchanged: the Redis cache (`redis.ts`, `cache.ts`), the cron write wrapper (`runCronWrite` in `cronWrite.ts`), the zod schemas (`UniswapGroupedResponseSchema` validates the v3 payload), `checkBearer` in `auth.ts`, and the three routes. `buildHealth` in `health.ts` keeps its stale check and active-only gating and gains the RPC fields.
- Replaced: the Graph fetchers (`graph.ts`, `subgraphs/`, `normalizeSubgraphData.ts`), `GRAPH_STUDIO_KEY`, the subgraph ids in `SUBGRAPH_SOURCES`, and the `buildRegistry` check that throws when a fetched pool has no subgraph source.
- Added: the Alchemy client, log ingestion, cursor and bucket storage under `rpc:` keys, pricing, the backfill and cross-check routes, chain config, and `key`, `anchor` and `createdBlock` on each Uniswap entry in `pool.json`.

### Where PR 52 changed the draft

- `runCronWrite` writes the payload after the fetch, outside the draft's single transaction (step 11).
- Its snapshot hash has no field for `block` and `prices`, which move to `rpc:<chain>:state` and `/api/health`.
- `pool.json` is an array, so the `chains` block becomes `src/server/pools/rpc/chains.ts`.
- It imports `@apollo/client` on the server until phase 8.
- It flags lag at a flat 3,600 s; phase 5 sets per-chain limits.
- A group that never loads drops out of the header note; phase 6 names it.

### Files per phase

Server file names without a folder are under `src/server/pools/`; `vercel.json` and `package.json` sit at the repository root.

| Phase | (A) this repository | (B) telx-backend |
| --- | --- | --- |
| 0 | PR 52, `fix/header-stats-freshness` | same |
| 1 | `src/data/pool.json`, `registry.ts`, `rpc/chains.ts` | `lib/pools.json`, `lib/pools.ts` |
| 2, 3 | `rpc/`, `src/app/api/admin/rpc-backfill/[chain]/route.ts` | `lib/rpc/`, `pages/api/v1/admin/rpc-backfill/[chain].ts` |
| 4 | `rpc/runChain.ts`, `rpc/store.ts`, `rpc/payload.ts`, `jobs.ts`, `groupedRead.ts`, `vercel.json` | `lib/rpc/`, `pages/api/v1/active/post/rpc/[chain].ts`, `lib/groupedRead.ts`, `lib/cache.ts`, `lib/schemas.ts`, `vercel.json` |
| 5 | `health.ts`, `rpc/crossCheck.ts`, `src/app/api/cron/crosscheck/route.ts` | `lib/health.ts`, `lib/rpc/crossCheck.ts`, `pages/api/v1/active/post/crosscheck.ts` |
| 6 | `src/components/home/Stats.tsx`, `src/helpers/prefetchGroupedSubgraph.ts`, `src/types/PoolMetrics.ts`, `src/helpers/groupedPayload.contract.test.ts` | same |
| 7 | telx-frontend Vercel project, `scripts/compare-v3.mjs` | telx-backend project and script |
| 8 | `graph.ts`, `subgraphs/`, `jobs.ts`, `vercel.json`, `archive/`, `package.json` | `lib/graph.ts`, `subgraphs/`, `pages/api/v1/active/post/*`, `lib/archive/`, plus the frontend cleanup |
| 9 | `docs/api-telx-network-integration.md` | `README.md`, `lib/openapi.ts`, `content/docs/`, plus the frontend doc |

## Target design

### Per-run algorithm

Every 5 minutes Vercel calls `/api/cron/uniswap-<chain>-rpc` (B: `/api/v1/active/post/rpc/<chain>`), and `GET /api/pools` serves the result for each group that `config:grouped-source` sets to `v3` (B: `GET /api/v1/active/get/uniswap-<chain>-grouped`).

1. Take the lock: `SET rpc:<chain>:lock <runId> NX PX 240000`. If it is held, answer 200 `skipped`.
2. Read the cursor C from `rpc:<chain>:cursor`. No cursor means no backfill: record the error and stop.
3. One `eth_call` to Multicall3 `aggregate3` at tag `finalized`, every sub-call with `allowFailure`: `getBlockNumber`, `getCurrentBlockTimestamp`, `latestRoundData` per Chainlink feed, and per pool `ReservesLens.getPoolTVL(poolManager, key)`, `StateView.getSlot0(id)` and `StateView.getLiquidity(id)`. This yields the finalized block F, its time, prices and pool state.
4. If F equals C, update the status hash and stop.
5. Let T be the smaller of F and C + `maxBlocksPerChunk` (12 hours of blocks). If T is below F, the run is catching up: repeat step 3 at T.
6. One `eth_getLogs`: `address` PoolManager, `topics` `[[Swap, ModifyLiquidity], [pool ids]]`, blocks C + 1 to T.
7. Reject the whole run if any log has another address, topic or pool id, falls outside the range, or is `removed`. Sort by block and log index.
8. Time each log from `blockTimestamp` if Alchemy returns it, else by interpolating between the times of C and T (phase 2 checks which applies per chain).
9. Price each Swap and add it to its 5-minute bucket and UTC day row; apply each ModifyLiquidity to the pool's liquidity map.
10. Compute TVL, metrics, 48 hourly rows and up to 95 daily rows.
11. One `MULTI`/`EXEC`: changed buckets, buckets older than 48 hours deleted, day rows, liquidity map, state, cursor = T. Under (A) `runCronWrite` then validates and writes the payload to `active-uniswap-<chain>-grouped:v3` with its status, and the lock expires on its own; under (B) payload and status join the transaction and the lock is released.
12. While catching up, repeat from step 5 with C = T, up to 4 chunks or 120 seconds per run, each chunk its own transaction (86 CU more).

### Swap math

- v4 Swap amounts are the swapper's deltas: negative was paid into the pool (the input), positive was received. v3 is the opposite; the subgraph negates them.
- Volume is the absolute amount of the pool's anchor token times its price. The anchor, set in the registry, is WETH or ETH in ETH pools and eUSD in eUSD pools, as in the measured volumes.
- The event `fee` in pips includes the protocol fee: 3499 = 500 + 3000 - floor(500 x 3000 / 1e6) for the 0.30% pools, 625 for eUSD/eMXN.
- Fees are `|input| x fee / 1e6 x input price`.
- Slot0 `protocolFee` holds zeroForOne pips in the low 12 bits and oneForZero pips in the high 12 bits (2,048,500 is 500 each way, 512,125 is 125). Protocol fees are `fees x protocolPips / fee`; LP fees are the rest.

### Pricing rules

- ETH (native on Base and Ethereum, WETH on Polygon): Chainlink ETH/USD on the same chain.
- eMXN: 1 MXN at Chainlink MXN/USD. Only Polygon has an eMXN pool, so only Polygon needs the feed.
- eUSD: fixed $1; there is no feed. Polygon runs record the eUSD price implied by the eUSD/eMXN pool and MXN/USD (about $0.987 on 2026-09-28) and warn above 3% off.
- TEL (TEL3, `0x7E13B43065380aCdeC1c2d138c579cbBbafA0731` on every chain): each TEL pool on the chain gives a route price from its `sqrtPriceX96` times the other token's price. Routes whose non-TEL side holds under $5,000 are dropped (the Base ETH/TEL pool held about $1,300). TEL is the median of the rest, the mean for two ($0.0024607 on Polygon on 2026-09-28). A move over 20% from the last stored price in one run is clamped and flagged. With no usable route the chain takes Polygon's latest TEL price, then its own last price, flagged stale.
- A Chainlink answer at or below zero, or older than the feed heartbeat plus 10 minutes, gives way to the last stored price, flagged.
- All prices come from the finalized block of the pool state and are stored under `prices` in `rpc:<chain>:state`.

### TVL

TVL is reserves times prices, with reserves from `ReservesLens.getPoolTVL(poolManager, key)` inside the bundle at no extra CU.
The Uniswap deployments page lists ReservesLens at `0x0000001b173C3bbF3984D417d8614E3eed34865B` on all three chains; on 2026-09-28 it had code on each, and the call worked on the three Polygon pools at 1.1M to 5.1M gas each.
Phase 2 confirms Alchemy's `eth_call` gas cap covers the bundle, and phase 3 that the lens matches the position sum at a pinned block.
The fallback, used when a lens sub-call fails, is the position sum: net liquidity per tick range from every ModifyLiquidity since creation, converted to token amounts at the current `sqrtPriceX96`.
It produced $146,959 and matched a full tick walk.
Health shows the gap between the two every run.
Neither counts uncollected fees, which is where the subgraph drifts.

### Redis layout

| Key | Type | Content | Kept |
| --- | --- | --- | --- |
| `rpc:<chain>:cursor` | hash | `block`, `timestamp`, `updatedAt` | always |
| `rpc:<chain>:lock` | string | run id | 240 s |
| `rpc:<chain>:b5m:<poolId>` | hash | bucket start (unix s) to JSON `{swaps, volumeUSD, feesUSD, lpFeesUSD, protocolFeesUSD, lastSwapAt}` | 48 hours |
| `rpc:<chain>:day:<poolId>` | hash | UTC day start to JSON `{swaps, volumeUSD, feesUSD, lpFeesUSD, tvlUSD}`, TVL at the day's last run | 95 days |
| `rpc:<chain>:liq:<poolId>` | hash | `tickLower:tickUpper` to net liquidity (decimal string) | always |
| `rpc:<chain>:state` | hash | per pool slot0, liquidity, reserves, TVL, last activity, cumulative fees; `block` and `prices` | latest |
| `rpc:<chain>:backfill` | hash | backfill progress | until done |
| `active-uniswap-<chain>-grouped:v3` | hash | `fetchedAt`, `indexedAt`, `hasIndexingErrors`, `data`, via `writeSnapshot` | latest |
| `status:active-uniswap-<chain>-grouped:v3` | hash | `lastSuccessAt`, `lastError`, `lastErrorAt`, `warnings`, `lastRun`, `crossCheck` | latest |
| `config:grouped-source` | hash | group to `v2` or `v3` | rollout only |

The lock outlives the cron route's 180-second `maxDuration`, so runs never overlap, and the cursor moves in the same transaction as the data it covers.
Retries are idempotent without compare-and-set: a run killed before `EXEC` wrote nothing, a failed payload write leaves the payload a run old until the next run rebuilds it from the buckets, and a duplicate cron call finds the lock and skips.
A failed run writes only the status hash.

### Backfill

`POST /api/admin/rpc-backfill/<chain>` (behind `CRON_SECRET`; B: `/api/v1/admin/rpc-backfill/<chain>`) walks from the earliest pool creation block to the finalized head in one-hour chunks, prices each chunk with the bundle at its end block (archive `eth_call`), and stores progress in `rpc:<chain>:backfill`.
Each call runs up to 150 seconds and answers `{ done, nextBlock }`; repeat it with curl until `done`.
ModifyLiquidity logs are replayed from each pool's creation even past 95 days, since the liquidity map needs all of them.
Backfilled TVL uses the position sum, because the lens may postdate old blocks.
The route finishes by writing the live cursor; `?reset=1` clears the chain's `rpc:` keys first.
Polygon's pools (created at blocks 94,330,869 to 94,331,054) take about 120 chunks and 10,000 CU; a 95-day history takes about 2,300 chunks and 200,000 CU.

### Response shape

The payload is PR 52's `GroupedResponse` (`src/server/pools/cache.ts`; B: `lib/cache.ts`), one entry of `groups` in the `/api/pools` body: `{ fetchedAt, indexedAt, hasIndexingErrors, parts: { hourly, daily, legacy }, data: [{ id, pool, poolSnapshots, threeMonthLiquidityData, metrics }] }`.
Both `parts` entries describe the single v3 key.

| Field the frontend reads | Where | Today | v3 source |
| --- | --- | --- | --- |
| `metrics.tvlUSD` | Uniswap reader, header totals | subgraph TVL | reserves times prices |
| `metrics.volume24h` | readers, totals | whitelisted hourly rows | 5-minute buckets in the trailing 24h, anchor side |
| `metrics.fees24h` | readers, totals | hourly `feesUSD` | swap fees, LP plus protocol |
| `metrics.lastSwapAt`, `lastActivityAt`, `createdAt`, `window` | `activityFields`, `PoolVolume.tsx` | subgraph rows | newest Swap, newest Swap or ModifyLiquidity, `Initialize` block time, `trailing-24h` |
| `pool.totalValueLockedUSD` | Uniswap reader when `metrics` is null | subgraph | same as `metrics.tvlUSD` |
| `poolSnapshots[]` | Uniswap reader legacy fallback | active hours only | 48 hourly rows, every hour, newest first |
| `threeMonthLiquidityData[]` `timestamp`, `tvlUSD`, `volumeUSD`, `feesUSD` | `src/components/chart/chart.ts` | active days only | every UTC day since creation, up to 95, newest first (`PoolChart` reverses labels, so keep the order) |
| `fetchedAt` | "Updated N min ago" | fetch time | write time |
| `indexedAt` | lag line in `Stats.tsx` | subgraph block time | finalized block time |

Changes in meaning:

- `indexedAt` is the finalized block time, which on 2026-09-28 trailed the head by about 5 seconds on Polygon, 15 minutes on Ethereum and 21 minutes on Base.
- `hasIndexingErrors` and `parts.legacy` are always `false`; phase 8 removes them.
- `rows24h` counts swaps, not hourly rows, and `pool.feesUSD` counts from the backfill start. No UI reads either.
- `volume24h` and `fees24h` now include the eUSD pools, so the header totals rise.
- The 24h window is exact to 5 minutes instead of to the hour.

### Health

`/api/health` (B: `/api/v1/health`) gets one entry per chain, `active-uniswap-<chain>-grouped:v3`, with the existing `KeyHealth` fields plus `cursorBlock`, `finalizedBlock`, `blocksBehind`, `finalizedLagSeconds`, `lastRun` (block range, logs, duration, CU), `block`, `prices` (feed `updatedAt`, TEL route spread, clamp and stale flags, implied eUSD), `tvlCheck` (lens against position sum) and `crossCheck`.
An entry is stale when its payload is over 900 seconds old, and lagging when `finalizedLagSeconds` passes a per-chain limit (Polygon 600, Ethereum 2,700, Base 3,600) or `blocksBehind` passes 12 hours of blocks.
A stale or lagging chain with an active pool makes the route answer 503.
Price flags, a lens gap over 1%, peg drift and cross-check divergence go into `warnings` and never fail the check.

The hourly cross-check (`/api/cron/crosscheck`; B: `/api/v1/active/post/crosscheck`) never feeds the payload.
It makes one keyless GeckoTerminal call per chain (`/networks/{polygon_pos|base|eth}/pools/multi/<ids>`; the limit is about 10 a minute) and compares `reserve_in_usd` with `tvlUSD` and `volume_usd.h24` with `volume24h`.
It records the result in the status hash, warns above 10% for volume or 25% for TVL (loose because of the eUSD/TEL gap), skips pools under $1,000 a day, and records a GeckoTerminal failure without raising it.

## Registry and configuration

Each Uniswap entry in `src/data/pool.json` gains `key` (`currency0`, `currency1`, `fee`, `tickSpacing`, `hooks`), `anchor` (0 or 1) and `createdBlock` in its `attributes`; PR 52's registry reads only the attributes it names, so the new ones break nothing (B: the same fields per pool in `lib/pools.json`, whose `sources` stays until phase 8).
Polygon "WETH/TEL polygon merkl" (`0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d`) gets `currency0` WETH and `currency1` TEL (addresses below), fee 3000, tick spacing 60, hooks `0x0000000000000000000000000000000000000000`, anchor 0 and block 94330930.
The active pools have no hooks and static fees: ETH/TEL on Base and Ethereum uses native ETH (`currency0` is the zero address) at fee 3000 and tick spacing 60, eUSD/TEL is 3000 and 60 on all three chains, and eUSD/eMXN is 500 and 10.
Creation blocks are known for Polygon only (WETH/TEL 94,330,930, eUSD/TEL 94,330,869, eUSD/eMXN 94,331,054); phase 1 finds the rest with one `Initialize` query per chain.

Chain config lives in `src/server/pools/rpc/chains.ts` (B: a `chains` block in `lib/pools.json`): `chainId`, `alchemyHost`, `blockTag` `finalized`, `maxBlocksPerChunk` (28800 on Polygon), `geckoTerminalNetwork`, `contracts` (`poolManager`, `stateView`, `reservesLens`, `multicall3`), `feeds` (address, `decimals` 8, `heartbeatSeconds`, TBD from data.chain.link in phase 1) and `tokens` (symbol, decimals, price rule).

| Chain | PoolManager | StateView | ETH/USD feed |
| --- | --- | --- | --- |
| Polygon (137, `polygon-mainnet`, `polygon_pos`) | `0x67366782805870060151383f4bbff9dab53e5cd6` | `0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a` | `0xF9680D99D6C9589e2a93a78A04A279e509205945` |
| Base (8453, `base-mainnet`, `base`) | `0x498581ff718922c3f8e6a244956af099b2652b2b` | `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71` | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |
| Ethereum (1, `eth-mainnet`, `eth`) | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `0x7ffe42c4a5deea5b0fec41c94c136cf115597227` | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` |

ReservesLens (`0x0000001b173C3bbF3984D417d8614E3eed34865B`) and Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) have the same address on every chain.
Polygon also has the MXN/USD feed `0x171b16562EA3476F5C61d1b8dad031DbA0768545`, and these tokens: WETH `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` (18 decimals, feed ETH/USD), TEL `0x7E13B43065380aCdeC1c2d138c579cbBbafA0731` (18, `fromPools`), eUSD `0x14913815bCFDE78BAeAd2111F463D038Ac9C2949` (6, `fixedUsd` 1) and eMXN `0x68727e573D21a49c767c3c86A92D9F24bd933c99` (6, feed MXN/USD).
The values were checked on 2026-09-28: addresses from the Uniswap deployments page, contract code and Chainlink `description()` on public RPCs, and every registry PoolKey read from PositionManager `poolKeys` and hashed back to its pool id.

## Phases

Each phase ends with `npm test` (jest) passing, plus vitest in telx-backend under (B).
Files marked (new) do not exist yet.
Paths are relative to `/Users/grant/coding/telcoin/telx-frontend/`; (B) paths in parentheses are relative to `/Users/grant/coding/telcoin/telx-backend/`.

### Phase 0: land PR 52 and rebase the freshness branch (0.5 day, outside the 7.5)

- [ ] Set `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `GRAPH_STUDIO_KEY`, `CRON_SECRET` and `HEALTH_CHECK_SECRET` on the telx-frontend Vercel project (without them `/api/pools` answers 503), then review and merge PR 52.
- [ ] Follow its cutover: check `/api/health` and this project's cron logs, then turn off the telx-backend Graph crons (#45).
- [ ] Rebase `fix/header-stats-freshness` on it. Take the PR's deletion of `src/data/backend-pools.json` and drop commit c311ea0, "Mirror the retired TEL2 and Balancer pools in the registry copy".
- [ ] Hand-merge `src/helpers/prefetchGroupedSubgraph.ts`: keep the branch's `requested` and `active` sets and `subgraphGroupOf`, make the PR's single `fetchGroupedSubgraphs(groups)` call, and set `sources[group]` in the PR's loop only when `active.has(group)`, so the active-group freshness logic reads the one `/api/pools` response.
- [ ] Rewrite the archived-group test in `src/helpers/fetchGroupedSubgraph.test.ts` ("fetches a group for its archived pools but keeps it out of the freshness") to mock one `/api/pools` response with the PR's `respondGroup` helper and expect one call, and merge the import block.

The six retired TEL2 and Balancer pools stay retired through `active: false` in `src/data/pool.json`, set by #41, which PR 52's registry reads.
After PR 52 a group that never loaded (Polygon today) is absent from the response, and the header note must still name it as unavailable (phase 6).

### Phase 1: registry and config (0.5 day)

- [ ] Add `key`, `anchor` and `createdBlock` to each Uniswap entry in `src/data/pool.json`, the chain config to `src/server/pools/rpc/chains.ts` (new), and typed accessors (`chainConfig`, `rpcPoolsFor`) to `src/server/pools/registry.ts`, whose `buildRegistry` now also requires `key` and `createdBlock` on active Uniswap pools (B: `chains` and the pool fields in `lib/pools.json`, accessors in `lib/pools.ts`).
- [ ] `scripts/verify-registry.mjs` (new): contract code, feed `description()` and decimals, token symbols and decimals, missing creation blocks from `Initialize` logs.
- [ ] `ALCHEMY_API_KEY` in `.env.sample`, `CONTRIBUTING.md` and the telx-frontend Vercel project; `viem` is already a dependency (B: `viem` in `package.json`, the key in `.env.sample` and the telx-backend project).
- [ ] Tests in `src/server/pools/registry.test.ts` (B: `lib/pools.test.ts` (new)): every key hashes to its pool id, every currency has a token with a price rule, every referenced feed exists, anchors are 0 or 1, active pools have a creation block.
- [ ] Check in the same test that each Uniswap pool's `decimals` in `pool.json` match the chain's token decimals (TEL2 has 2, TEL3 has 18) (B without PR 52: resync `src/data/backend-pools.json` with `npm run sync:pools` and put the check in `src/data/poolRegistry.test.ts`, which reads only `protocol`, `chain`, `id`, `name` and `active`, so the new fields break nothing).

### Phase 2: RPC client, log ingestion and backfill (1.5 days)

- [ ] `src/server/pools/rpc/` (new; B: `lib/rpc/`), every module importing `server-only`: `client.ts` (Alchemy URL per chain, viem client, timeouts, errors naming chain and method), `abi.ts`, `snapshot.ts` (build and decode the bundle), `logs.ts` (filtered `eth_getLogs`, validation, decoding, timestamps).
- [ ] `src/app/api/admin/rpc-backfill/[chain]/route.ts` (new; POST, `checkBearer` for `CRON_SECRET`, `maxDuration` 180; B: `pages/api/v1/admin/rpc-backfill/[chain].ts`).
- [ ] With the real key, check per chain: `blockTimestamp` on logs, the `finalized` tag, the gas cap against the bundle (about 7.5M gas on Polygon), unlimited block range.
- [ ] `scripts/record-fixture.mjs` (new) writes `src/server/pools/__fixtures__/rpc/polygon-2026-09-28.json` (new; B: `lib/__fixtures__/rpc/polygon-2026-09-28.json`): the Polygon pools' logs for blocks 94,560,737 to 94,618,337 and the bundle at 94,618,337.
- [ ] Tests (new) beside the modules: `logs.test.ts` (decoding, negative amount is the input, rejection of foreign address, topic, pool id, `removed` and out-of-range logs, interpolated times), `snapshot.test.ts` (a failed lens sub-call decodes to null), `client.test.ts` (missing key throws, 429 and -32600 surface).

### Phase 3: metrics and pricing (1 day)

- [ ] New in `src/server/pools/rpc/` (B: `lib/rpc/`): `swapMath.ts`, `pricing.ts`, `tvl.ts` (lens and position sum), `buckets.ts` (5-minute buckets, hourly and daily rollups, pruning, metrics).
- [ ] Unit tests (new) beside each: 3499 and 625 pips; 2,048,500 and 512,125 unpack to 500 and 125; the protocol share of a 3499-pip fee is 500/3499; a swap signed the v3 way reads as the opposite direction; stale or non-positive feeds fall back and flag; thin routes are dropped; the clamp stops at 20%; the position sum is right below, inside and above a range; a swap exactly 24 hours old is inside the window, as in `deriveUniswapMetrics`; quiet hours give zero rows.
- [ ] `golden.test.ts` (new) in the same folder (B: `lib/rpc/golden.test.ts`) replays the fixture: swap counts exact, volume and fees within 0.1%, TVL within 0.5% (eUSD/eMXN against $45,457), lens and position sum within 0.5%.

### Phase 4: storage, jobs and reads (1 day)

- [ ] New in `src/server/pools/rpc/` (B: `lib/rpc/`): `runChain.ts` (algorithm, lock, catch-up, transaction), `store.ts` (`rpc:` keys and the v3 key), `payload.ts` (Graph-shaped rows and metrics).
- [ ] `src/server/pools/jobs.ts`: jobs `uniswap-polygon-rpc`, `uniswap-base-rpc` and `uniswap-ethereum-rpc`, each writing `active-uniswap-<chain>-grouped:v3` through `runCronWrite` with `UniswapGroupedResponseSchema` (B: `pages/api/v1/active/post/rpc/[chain].ts` (new), `maxDuration` 180).
- [ ] `vercel.json`: three `*/5` crons for `/api/cron/uniswap-<chain>-rpc` (B: for `/api/v1/active/post/rpc/polygon`, `/base` and `/ethereum`).
- [ ] `src/server/pools/groupedRead.ts`: when `config:grouped-source` names `v3` for the group, serve the v3 key as `mergeGroupedParts(v3, v3)`, so both `parts` entries describe it (B: the same in `lib/groupedRead.ts`, a v3 key helper in `lib/cache.ts`, and a zod schema for the v3 payload in `lib/schemas.ts`, checked before every write).
- [ ] Tests: `src/server/pools/rpc/runChain.test.ts` (new; fake RPC and `fakeRedis` from `testing.ts`: a repeated range gives the same state, a held lock skips, an RPC error leaves data keys alone and sets `lastError`, a 30-hour gap runs in 12-hour chunks, no cursor fails); extend `groupedRead.test.ts`, `schemas.test.ts` (the v3 fixture passes) and `src/app/api/cron/[job]/route.test.ts` (B: `lib/rpc/runChain.test.ts`, `lib/groupedRead.test.ts`, `lib/schemas.test.ts`).

### Phase 5: health and cross-check (0.5 day)

- [ ] `src/server/pools/health.ts` (B: `lib/health.ts`): v3 chain entries, per-chain lag limits in place of the flat 3,600 s, `warnings`.
- [ ] `src/server/pools/rpc/crossCheck.ts` (new) and `src/app/api/cron/crosscheck/route.ts` (new; `checkBearer`; the static segment wins over `[job]`), with an hourly cron in `vercel.json` (B: `lib/rpc/crossCheck.ts`, `pages/api/v1/active/post/crosscheck.ts`).
- [ ] Tests: extend `src/server/pools/health.test.ts` (per-chain limits, warnings never fail `ok`, archive entries never gate); `src/server/pools/rpc/crossCheck.test.ts` (new: thresholds, small pools skipped, a 429 is recorded, not raised) (B: `lib/health.test.ts`, `lib/rpc/crossCheck.test.ts`).

### Phase 6: frontend (0.5 day)

These edits accept v2 and v3 payloads alike, so they ship before the switch; the second can ship right after phase 0.

- [ ] `src/components/home/Stats.tsx`: replace "Subgraph data is N min behind" with a line per lagging group ("Base data is 25 min behind"), at 10 minutes for Polygon and 45 for Base and Ethereum instead of a flat 30 (Base finality alone is about 21); delete "Subgraph reported indexing errors". Update `src/components/home/Stats.test.tsx`.
- [ ] Name a group that never loaded: `src/helpers/prefetchGroupedSubgraph.ts` lists the active groups that `/api/pools` put in `failed` or left out, `DataFreshness` in `src/types/PoolMetrics.ts` gains `unavailable`, and `Stats.tsx` shows "Polygon data is unavailable". Test it in `Stats.test.tsx` and `src/helpers/fetchGroupedSubgraph.test.ts`.
- [ ] `src/helpers/groupedPayload.contract.test.ts` (new): mock `/api/pools` with `{ groups: { "uniswap-polygon": fixture }, failed: {} }`, run `fetchGroupedSubgraphs`, `uniswapGetSingleContractData` and `getChartData`, and check TVL, volume, fees, `lastSwapAt`, and chart length and order. The fixture is `src/server/pools/__fixtures__/uniswap-polygon-grouped.v3.json` (new), the one the schema test reads (B: `src/helpers/__fixtures__/uniswap-polygon-grouped.v3.json` (new), copied from the backend schema fixture).

### Phase 7: parallel run and cutover (1 day of work over 2 calendar days)

- [ ] Deploy phases 1 to 5 with `config:grouped-source` empty: reads serve v2 while the v3 crons write alongside.
- [ ] Backfill each chain, then watch three cron runs in `/api/health` (B: `/api/v1/health`).
- [ ] Switch Polygon first, since it has no live data to lose: `HSET config:grouped-source uniswap-polygon v3`, no deploy.
- [ ] Compare for 24 hours with `scripts/compare-v3.mjs` (new; one row per pool from both payloads and GeckoTerminal). Accept when the golden test passes, volume is within 5% of GeckoTerminal for pools above $1,000 a day, ETH/TEL volume on Base and Ethereum is within 5% of v2 (the subgraph prices ETH correctly), eUSD pools show volume wherever GeckoTerminal does, lens and position sum agree within 1%, health stayed ok, and Alchemy shows under 80,000 CU a day.
- [ ] Switch `uniswap-base` and `uniswap-ethereum`, then deploy phase 6.
- [ ] For option (a) of decision 3, freeze the archived pools now, while the Graph still answers.

### Phase 8: Graph removal and cleanup (1 day)

Server, after a week on v3 (under (B) with PR 52 merged, in both repositories):

- [ ] Delete `src/server/pools/graph.ts`, `graph.test.ts`, `normalizeSubgraphData.ts`, `normalizeSubgraphData.test.ts` and the folder `src/server/pools/subgraphs/`, moving the `SubgraphFetch` type to `cronWrite.ts` (B: `lib/graph.ts`, `lib/graph.test.ts`, `lib/normalizeSubgraphData.ts`, `lib/normalizeSubgraphData.test.ts`, `subgraphs/`).
- [ ] Delete the nine Graph jobs from `src/server/pools/jobs.ts` and their crons from `vercel.json` (B: `uniswap-base-grouped.ts`, `uniswap-polygon-grouped.ts`, `uniswap-ethereum-grouped.ts`, `uniswap-base-history.ts`, `uniswap-polygon-history.ts`, `uniswap-ethereum-history.ts`, `balancer-grouped.ts`, `balancer-history.ts` and `quickswap-grouped.ts` in `pages/api/v1/active/post/`, and their nine crons).
- [ ] Remove `GRAPH_STUDIO_KEY` from `.env.sample`, `CONTRIBUTING.md` and every Vercel environment, and `SUBGRAPH_SOURCES`, `subgraphIdFor`, the subgraph-source check in `buildRegistry` and the subgraph-id pins from `registry.ts` and `registry.test.ts` (B: `@apollo/client` and `graphql` from `package.json`, the key from `.env.sample`, and `sources` from `lib/pools.json`).
- [ ] In `src/server/pools/` (B: `lib/`): drop the subgraph schemas from `schemas.ts`; `deriveUniswapMetrics`, `deriveBalancerMetrics` and `deriveQuickswapMetrics` from `metrics.ts` (keep `PoolMetrics`); the v2 keys, split-key helpers and source flag from `cache.ts`, `groupedRead.ts` and `health.ts` (B: also `legacyResponse` and `legacyKey`); and, once the frontend part of this phase is live, `hasIndexingErrors` and `parts` from the payload, with `mergeGroupedParts`. Replace `__fixtures__/*-grouped.json` and update `cache.test.ts`, `groupedRead.test.ts`, `health.test.ts`, `schemas.test.ts` and `metrics.test.ts`.
- [ ] Serve archived pools per decision 3; for option (a), `src/server/pools/archive/<group>.json` (new; B: `lib/archive/<group>.json`), read by `groupedRead.ts`, with TEL2 Uniswap rows appended to their chain's payload.
- [ ] Fourteen days later, delete the Redis keys `active-*-grouped:v1`, `:hourly:v2`, `:daily:v2`, `active-quickswap-grouped:v2`, their `status:` hashes and `config:grouped-source`.

Frontend:

- [ ] `src/helpers/fetchGroupedSubgraph.ts`: remove the bare-array and legacy branches from `parseGroupedBody`, and `LEGACY_FALLBACK_MAX_AGE_MS`; missing `metrics` becomes `null`.
- [ ] Drop `hasIndexingErrors` from `src/types/PoolMetrics.ts` and `src/helpers/prefetchGroupedSubgraph.ts`.
- [ ] Remove the legacy fallbacks from `src/web3/getContracts/uniswapv4/getSingleContractData.ts`, `src/web3/getContracts/balancer/getSingleContractData.ts` and `src/web3/getContracts/quickswap/getSingleContractData.ts`.
- [ ] Remove `@apollo/client` and `graphql` from `package.json`; after the server deletions nothing imports them.
- [ ] Update `src/helpers/fetchGroupedSubgraph.test.ts`, `src/redux/slices/contractsSlice.test.ts`, `src/components/layout/AppLayout.test.tsx` and `src/web3/getContracts/uniswapv4/getSingleContractData.test.ts`.
- [ ] Keep `subgraph_id` in `pool.json` (the Balancer Vault pool id), the `fetchSubgraph` flag and the `fetchGroupedSubgraph*` names; renaming removes no dependency. PR 52 already deleted the routes under `src/app/api/backend/subgraphs/` and the registry copy.

### Phase 9: docs (0.5 day)

- [ ] `docs/api-telx-network-integration.md` (PR 52's "Pool Data Pipeline"): data source, crons and keys, `ALCHEMY_API_KEY`, health fields, backfill runbook, response shape, metric meanings (eUSD at $1, anchor-side volume, fees including the protocol share), readers, registry fields and the "To add a pool" steps; remove "Older payload shapes" (B: only the frontend-side parts, and remove "Legacy payloads").
- [ ] (B) `README.md`: data source, crons, env vars, health, backfill runbook.
- [ ] (B) `content/docs/telx-backend-api-integration.md`: data source, freshness fields, metric meanings.
- [ ] (B) `lib/openapi.ts`: remove the nine POST paths, `SubgraphMeta` and the "Subgraph values" descriptions; add the `rpc/{chain}`, `crosscheck` and backfill routes, the new `indexedAt` and the registry `chains`.

## Decisions needed from Grant

1. Placement. Recommendation: (A) if PR 52 will merge, otherwise (B); see "Cross-reference with PR #52".
2. telx-backend. Recommendation: retire it, as PR 52's cutover says (#45): turn off its crons in phase 0, remove `TELX_BACKEND_SECRET_KEY`, archive the repository and delete its Vercel project. The frozen archived-pool data lives in this repository (decision 3).
3. Archived pools. The Balancer, QuickSwap and TEL2 Uniswap pools also come from The Graph and appear on the archive, wallet and portfolio pages.
   - Option (a), recommended: freeze each archived pool's last good row and delete its jobs. `scripts/freeze-archive.mjs` (new) takes Balancer, QuickSwap and the Base and Ethereum TEL2 pools from the latest v2 keys (check `fetchedAt` first), and the Polygon TEL2 pools from the Polygon subgraph pinned to block 94,494,303, which still answers, or from the 2026-09-21 `:v1` entry, which PR 52 stops reading but leaves in the store. Frozen metrics keep `tvlUSD`, `lastSwapAt` and `createdAt`, and set `volume24h`, `fees24h` and `window` to `null`. Half a day, inside phase 8.
   - Where the freeze lives. Recommendation: static JSON, `src/server/pools/archive/<group>.json`, read by `groupedRead.ts`: reviewed, versioned, and safe from a store flush and the phase 8 key cleanup. Writing the frozen payloads once into PR 52's Redis `:v2` keys needs no read code, but the data goes unreviewed, the cleanup must skip those keys, and the TEL2 rows still need code to join their chain's v3 payload.
   - Effect of (a): the archive list (`src/components/pools/ArchivePage.tsx`, `src/components/archive/ArchiveCard.tsx`) does not change; its cards show assets, staking addresses and dates only. The pool page (`src/app/pool/[poolID]/PoolDetails.tsx`) shows live Balancer TVL (the frontend reads the Vault whenever a row exists), frozen TVL for QuickSwap and TEL2 Uniswap pools, "Unavailable" for 24h volume and fees, and charts ending at the freeze date. Wallet and portfolio balances and rewards are on-chain reads and do not change; QuickSwap staked USD derives from the frozen TVL and drifts with prices, while Balancer staked USD uses the live Vault TVL.
   - Option (b): compute them from RPC too. The TEL2 Uniswap pools sit on the same PoolManagers, so they join the same log filter and bundle at no extra CU, but need a TEL2 price rule (2 decimals, separate markets) and have two run hooks (`0x23aB2e6D4Ab0c5f872567098671F1ffb46Fd2500` on Base, `0xD77cC9230Ded5b6591730032975453744532a500` on Polygon). Balancer needs Vault `getPoolTokens` and swap fees in the bundle, Vault Swap events, and USDC, WBTC and TEL2 prices. QuickSwap needs pair `getReserves`, pair Swap events, and QUICK and WMATIC prices. Their events need a second Polygon `eth_getLogs` (about 0.5M CU a month). Two to three more days and five more price assumptions. The TEL2 Uniswap pools can move to (b) later, with no new RPC calls, once a TEL2 price rule exists.
4. Cadence and block tag. Recommendation: every 5 minutes, with `finalized` on every chain (Base about 21 minutes and Ethereum about 15 behind the head). The `safe` tag cuts that to about 1 and 8 minutes at the same cost, but can reorg, which this design does not handle.
5. Alchemy app and key. Recommendation: a separate app on the Pay As You Go team (confirm it is not on the Free plan), its key only in the Vercel project that runs the crons (telx-frontend under (A), telx-backend under (B)) as the server-only `ALCHEMY_API_KEY`, no domain allowlist (server calls send no `Origin`), a contract allowlist if Alchemy applies one to `eth_getLogs`, and a $10 monthly spend alert. Reusing `ALCHEMY_ID` works with an allowlisted `Origin`, but shares quota and abuse exposure with the public RPC proxy, and one rotation breaks both.
6. eUSD peg. Recommendation: $1, with the implied price in health and a warning above 3% off. Pricing eUSD through the eUSD/eMXN pool and MXN/USD would tie it to eMXN's peg instead.
7. GeckoTerminal cross-check. Recommendation: keep it: keyless, three calls an hour, warning only, and it already shows the eUSD/TEL TVL gap.
8. Fee figure. `fees24h` today includes the protocol share ($755 for WETH/TEL; LPs earn $647). Recommendation: keep the total for now; buckets store LP fees too, so switching later is a one-line change.

## Risks and mitigations

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Alchemy outage or rate limit | payload ages | data key untouched on failure, health 503 after 15 min, catch-up on recovery; no second provider, by decision |
| Team on the Free plan | `eth_getLogs` fails on the 10-block cap | confirm the plan before phase 7; `lastError` shows it |
| ReservesLens reverts, exceeds the gas cap or disagrees | TVL missing or wrong | `allowFailure`, position-sum fallback, gap in health, golden test |
| Chainlink feed stale or paused | ETH or MXN price off | heartbeat check, last good price, flags |
| eUSD off its peg | eUSD pools overstated | implied-price warning at 3%; documented |
| eMXN off MXN (1.3% on 2026-09-28) | eUSD/eMXN TVL off by as much | documented; cross-check |
| TEL price thin or manipulated | TVL and TEL-side fees off | finalized block, $5,000 route floor, median, 20% clamp, Polygon fallback |
| Bridged WETH priced as ETH | wrong only if the bridge fails | documented |
| Logs without `blockTimestamp` | bucket edges off by seconds | interpolation; Base blocks are exactly 2 s |
| Missed runs | 24h figures lag | bounded catch-up; `blocksBehind` in health |
| Duplicate or overlapping cron calls | double counting | lock; cursor moves with the data |
| A ModifyLiquidity missed in the replay | fallback TVL drifts | lens is primary; gap checked every run; `?reset=1` rebuilds |
| Registry error (key, decimals, TEL2 against TEL3) | wrong pool or amounts off by 10^16 | key-hash test, verify script, decimals test |
| Protocol fee changed mid-window | LP and protocol split off | split read every run; totals come from the event fee |
| Payload drift | frontend breaks | zod check before every write; contract test on the same fixture |
| Header totals jump at cutover | looks like a bug | expected (Polygon restored, eUSD pools counted); say so in the release note |
| Base finality slows with L1 congestion | lag warnings | per-group thresholds; `safe` is a config change |
| PR 52 does not merge | (A) has no base | phase 0 gates phase 1; every step names its (B) file |
| A group never loads after PR 52 | the header note drops it | phase 6 names it as unavailable |

## Rollback

- Before phase 8: `HSET config:grouped-source <group> v2` serves v2 at once, with no deploy; the v3 crons can keep running. Polygon has no v2 data and no `:v1` fallback after PR 52, so it goes back to unavailable.
- The phase 6 frontend handles both payloads and stays.
- After phase 8: revert the cleanup commits (under (B), in both repositories), restore `GRAPH_STUDIO_KEY` in the Vercel project that runs the crons (keep the key for 30 days after removal), and redeploy. The v2 keys live 14 days past phase 8, so reads answer at once; after that the restored crons refill them within an hour.
- v3 data can be rebuilt at any time with the backfill route and `?reset=1`.

## Sources

- https://github.com/Telcoin-Association/telx-frontend/pull/52 and `/Users/grant/coding/telcoin/telx-frontend/tasks/pr-52-summary.md`: PR 52, its files and its conflicts with `fix/header-stats-freshness`.
- `/Users/grant/coding/telcoin/telx-frontend/report-uniswap-subgraph.md`: the problems.
- `/Users/grant/coding/telcoin/telx-frontend/tasks/checkpoint-research-onchain.md`: addresses, topics, sign convention, fee math, TVL methods, measured numbers.
- `/Users/grant/coding/telcoin/telx-frontend/tasks/checkpoint-research-alchemy-costs.md`: CU costs, plans, `eth_getLogs` caps.
- `/Users/grant/coding/telcoin/telx-frontend/tasks/checkpoint-research-providers.md`: GeckoTerminal and ReservesLens.
- `/Users/grant/coding/telcoin/telx-frontend/docs/api-telx-network-integration.md`: the payload contract.
- Uniswap v4 deployments: https://developers.uniswap.org/docs/protocols/v4/deployments (https://docs.uniswap.org/contracts/v4/deployments redirects there).
- Uniswap v4-subgraph (whitelists, PR #42, PR #88): https://github.com/Uniswap/v4-subgraph
- Alchemy compute units: https://www.alchemy.com/docs/reference/compute-unit-costs
- Alchemy Pay As You Go: https://www.alchemy.com/docs/reference/pay-as-you-go-pricing-faq
- Alchemy `eth_getLogs` limits: https://www.alchemy.com/docs/chains/polygon-pos/polygon-po-s-api-endpoints/eth-get-logs, https://www.alchemy.com/docs/chains/base/base-api-endpoints/eth-get-logs, https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-logs
- Alchemy errors and batches: https://www.alchemy.com/docs/reference/error-reference, https://www.alchemy.com/docs/reference/batch-requests
- GeckoTerminal: https://api.geckoterminal.com/api/v2/networks/polygon_pos/pools/multi/<poolId>,<poolId>
- Chainlink feed heartbeats: https://data.chain.link
