# Why the TELx pool numbers are wrong: the Uniswap subgraph problems

Written 2026-09-28 from production probes of telx.network and api.telx.network, the two repositories, Uniswap's v4-subgraph source, The Graph explorer, and the public status endpoints of the indexers that serve the subgraphs.
Every number below is from that day unless dated otherwise.

## Summary

The header stats on telx.network showed "Updated 10123 min ago" because the Polygon pool data behind them has been frozen since 2026-09-21, and the note dated the whole header by its oldest source.
The Polygon data is frozen because the backend's Polygon crons fail on every run: Uniswap's published Polygon v4 subgraph crashed on a swap on 2026-09-26 and every query to it now fails at The Graph gateway.
Nobody has republished a fixed Polygon build.

That is the visible failure.
Under it are two problems that also affect Base and Ethereum.
Uniswap's subgraphs only price pools through a short list of whitelisted tokens, and TEL, eUSD and eMXN are not on it on any chain, so the subgraphs report zero volume and zero fees for the eUSD/TEL and eUSD/eMXN pools and a near-zero TVL for some of them.
And the Ethereum subgraph carries the same crash bug as Polygon; it still answers only because one indexer happens to have pruned the bad block.

Two branches carry the fixes that code can provide (see "What has been changed").
The data source itself needs a decision; the options are listed at the end.

## How the numbers reach the page

1. `src/data/pool.json` lists every pool. `AppLayout` loads it, then `fetchAllContractData` runs `prefetchGroupedSubgraph`, which fetches one grouped payload per backend group: `uniswap-base`, `uniswap-polygon`, `uniswap-ethereum`, `balancer`, `quickswap`.
2. The frontend routes under `src/app/api/backend/subgraphs/` proxy to `api.telx.network/api/v1/active/get/<group>-grouped` with the backend secret.
3. The backend answers from Vercel KV. Since PR #10 (deployed 2026-09-28) each Uniswap chain and Balancer has an hourly-rows key refreshed every 5 minutes and a daily-rows key refreshed hourly. QuickSwap has one hourly key.
4. The crons fill those keys by querying The Graph gateway with `GRAPH_STUDIO_KEY`. The subgraph ids live in `lib/pools.json` in the backend.
5. The header totals sum the active pools. The "Updated" note comes from the payloads' `fetchedAt`.

## Problem 1: the Polygon payload is a frozen snapshot from 2026-09-21

`GET /api/backend/subgraphs/uniswap-polygon-grouped` returns `parts.legacy: true`, `indexedAt: null`, and a `fetchedAt` of 2026-09-21 18:00 UTC.
The payload holds only the four retired TEL2 pool ids (0x25412ca3, 0x29f94ec9, 0x9a005a0c, 0xfd56605f).
The three active TEL3 Polygon pools (WETH/TEL 0xa22a3fb3, eUSD/TEL 0x1266df87, eUSD/eMXN 0xe604df8f) are absent, so they contribute nothing to TVL, volume or fees.

The backend's reader (`lib/groupedRead.ts`) serves the old `:v1` key whenever both v2 keys are missing, and a failed cron never touches a data key (`lib/cronWrite.ts`).
The Polygon v2 keys have never been written because every run of the Polygon crons fails (Problem 2).
Why the old v1 cron stopped writing on 2026-09-21, five days before the subgraph broke, is not known; the answer is in `lastError` on `/api/v1/health`, which needs the secret.

The frontend already treats a legacy payload older than an hour as unknown (`LEGACY_FALLBACK_MAX_AGE_MS`), so the frozen rows never reached the totals.
They only reached the note.

## Problem 2: Uniswap's Polygon v4 subgraph has crashed and cannot be queried

The backend points at subgraph `CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND` ("uniswap-v4-polygon", published by Uniswap's account 0x29ff57f9 on 2025-02-06, deployment `QmX7sRTz1C9CQrxgpcNiyKgwiEzS3PPEi5mBbzHgfKQCBS`).

- Its mapping has a bug in `handleSwap` (`swap.ts` line 39): a swap on a pool the subgraph skipped at initialisation (a token without `decimals()`) dereferences a null. Uniswap fixed it in v4-subgraph PR #42 on 2025-07-22 but never redeployed the February builds.
- Both indexers that serve the deployment report it `unhealthy`: ellipfra's first deterministic error is at block 94,494,304 (2026-09-26 18:16 UTC); tehn-r's at block 94,605,596 (2026-09-28). New errors keep appearing.
- The manifest declares `nonFatalErrors`, so an indexer still answers, but with an `indexing_error` flag. The gateway refuses to relay a flagged answer (it cannot be attested), and the client sees `bad indexers … BadResponse(no attestation: indexing_error)`. Passing `subgraphError: allow` does not get past the gateway (nightswatchhq/graph-support #40).
- There is no healthy replacement on the network. The only other Polygon v4 subgraph (`2UKncUpdgZeJVyh6Dv8ai2fTL2MQnig8ySh7YkYcHCsL`) predates the fix and has no signal and no indexers. DefiLlama's adapter reads a third id (`2CB2uQxcDKWDenagn2z17KQVCtfwSx5eXYuvqTciRTJu`) whose TVL for WETH/TEL kept moving after 09-26, so it may be healthy, but that was not verified with a query, and it runs the same code, so Problem 4 applies to it too.
- Uniswap describes these endpoints as "not official" and advises running your own.

Base works because its subgraph ("uniswap-v4-base-3", `Gqm2b5J85n1bhCyDMpGbtbVn4935EvvdyHdHrx3dibyj`) was built on 2025-08-14, after the fix.

## Problem 3: the Ethereum subgraph carries the same bug

`DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G` ("uniswap-v4-ethereum") was built from the same commit as Polygon.
Four of its five indexers are unhealthy.
The one that answers, tehn-r, keeps only about four hours of history and has pruned the failing block, which is luck, not design.
A fixed community republish exists (`EzLH76…`, publisher 0xabdcd4b8, reported healthy by its indexers) but has not been tried with a query.

## Problem 4: the subgraphs cannot price TEL, eUSD or eMXN

Uniswap's v4 subgraph only computes USD figures through a per-chain whitelist (`src/utils/chains.ts`):

| Chain | Whitelisted tokens |
| --- | --- |
| Polygon | WMATIC, WETH, USDC.e, DAI, USDC, native POL |
| Base | WETH, USDC, native ETH, ZORA |
| Ethereum | 25 tokens (WETH, DAI, USDC, USDT, WBTC and others); none of ours |

Consequences, confirmed against the production payloads:

- A swap counts toward `volumeUSD` and `feesUSD` only if one side is a whitelisted token. eUSD/TEL and eUSD/eMXN have none, so the subgraph reports zero volume and zero fees for them on every chain, even when the pool is busy. Production shows eUSD/TEL with `volume24h: 0` on Base and Ethereum.
- TVL uses each token's derived price. TEL gets a price only through a WETH/TEL pool that holds more than the chain's minimum (20,000 WMATIC-equivalent on Polygon, 1 ETH on Base and Ethereum). The Base ETH/TEL pool holds about $1,300, below that floor, so TEL is unpriced on Base, and the eUSD/TEL pool shows a TVL of $3.22. Ethereum shows $4.45. eUSD is never priced anywhere.
- Even for a priced pool the subgraph's TVL drifts. It adds swap flows and never subtracts the fees LPs collect (v4-subgraph PR #88, open). For Polygon WETH/TEL the subgraph method gives $149,098 against $146,959 from summing the positions, a 1.5% gap after five days.
- The subgraph's `feesUSD` includes the protocol's share. The WETH/TEL and eUSD/TEL pools charge 0.30% to LPs plus 0.05% protocol fee; eUSD/eMXN charges 0.05% plus 0.0125%.

What the Polygon pools actually did in the 24 hours before 2026-09-28 18:00 UTC, read from PoolManager swap logs and StateView through public RPCs:

| Pool | Swaps | Volume | Fees (LP + protocol) | TVL (positions) |
| --- | --- | --- | --- | --- |
| WETH/TEL | 1,310 | $215,853 | $755 ($647 + $108) | $146,959 |
| eUSD/TEL | 358 | $40,905 | $143 ($123 + $20) | $48,505 |
| eUSD/eMXN | 227 | $981 | $0.61 | $45,741 |

GeckoTerminal, which reads the chain itself, agrees to within a few percent (WETH/TEL $149.6k TVL and $215k volume; eUSD/TEL $56.8k and $40.5k; eUSD/eMXN $45.6k and $969).

## Problem 5: the subgraphs rest on very little

Curation signal is what tells indexers a subgraph is worth running.
The Polygon subgraph has about 621 GRT of signal and two indexers.
Base has one indexer.
Ethereum has five, four of them broken.
The Graph is also moving Polygon Subgraph Studio traffic to the network in October 2026, and from 6 October indexer eligibility counts only subgraphs with 500 GRT or more, so a zero-signal publish will not be picked up.

## Problem 6: gaps in the backend that let the outage hide

- A cron that fails forever leaves its last good data in place, and the GET keeps serving it. The only signs are `parts.legacy: true` and an old `fetchedAt`.
- `/api/v1/health` shows `lastError`, but it needs the secret, and nothing alerts on it.
- `assertPoolsPresent` fails a whole group when any registered pool id is missing from the subgraph, archived pools included.
- Hourly rows exist only for hours with activity, so a quiet pool has zero rows and its 24h volume renders as "Unavailable".
- The registry `lib/pools.json` still marked six retired pools (three TEL2 Uniswap pools and the three Balancer pools) as active, which the frontend's `poolRegistry.test.ts` catches. Fixed on the backend branch.

## Problem 7: gaps in the frontend note

- The note took the oldest `fetchedAt` across every fetched group, including Balancer and QuickSwap, which are fetched only for archived pools. One frozen group dated numbers that did not come from it. Fixed on the frontend branch.
- The age was printed in minutes only, so a week read as "10123 min". Fixed.
- `pool.json` reuses the numeric ids 32, 33 and 34 for two different pools each. Harmless today, worth cleaning.

## What has been changed

Frontend branch `fix/header-stats-freshness` (not pushed):

1. Freshness is computed only from groups that have an active pool.
2. Ages read as minutes, hours or days.
3. The note is dated by the newest group and names each stale group ("Updated 3 min ago", then "Polygon data is 7 days old").
4. The registry copy retires the six TEL2 and Balancer pools.

Backend branch `fix/registry-retired-pools` (not pushed): the same six pools set inactive in `lib/pools.json`, health tests updated.

Neither branch restores Polygon data.
Nothing in these repositories can, while the source is the broken subgraph.

## Options for the data source

Detailed in the chat summary of 2026-09-28; in short:

- Read the chain directly from the existing backend crons: PoolManager `Swap` logs for volume and fees, StateView or Uniswap's ReservesLens for TVL, Chainlink for ETH and MXN prices, TEL priced from the pools. Exact numbers for all pools on all chains, about 1 to 2 million Alchemy compute units a month, two to three days of work.
- GeckoTerminal's public API, which lists all seven active pools by pool id on all three chains with TVL and 24h volume (fees derived as volume times the LP fee). Free with a demo key at 10k calls a month.
- Publish a trimmed fork of Uniswap/v4-subgraph (only our pools, eUSD whitelisted, `nonFatalErrors` removed) to The Graph with about 3,000 GRT of signal. Keeps the current backend code, adds a resync on every upstream change.
- Hosted subgraph platforms (Goldsky, Ormi, OnFinality) running that same fork.

Switching Polygon to `2CB2uQxc…` or Ethereum to `EzLH76…` would stop the crash errors if those deployments are healthy, but the whitelist problem stays.

## How to confirm the diagnosis

With the backend secret:

```
curl -H "Authorization: Bearer $TELX_BACKEND_SECRET_KEY" https://api.telx.network/api/v1/health
```

`lastError` for `active-uniswap-polygon-grouped:hourly:v2` should contain "bad indexers" and "indexing_error".

With the Graph key, against `https://gateway.thegraph.com/api/subgraphs/id/CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND`:

```
{ _meta { block { number timestamp } hasIndexingErrors deployment }
  pools(where: { id_in: ["0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d"] }) { id createdAtTimestamp } }
```

Expect the gateway error above.
The same query pinned to `block: { number: 94494303 }` answers, because that block predates the crash.

## Sources

- Uniswap v4-subgraph: https://github.com/Uniswap/v4-subgraph (PR #42 fix, PR #88 TVL drift, `src/utils/chains.ts` whitelists)
- Graph support issues on the same crash: https://github.com/nightswatchhq/graph-support/issues/32 and /40
- Indexer status: https://graph-l2prod.ellipfra.com/status and https://index.tehn.in/status
- Uniswap on its subgraph endpoints: https://developers.uniswap.org/docs/ecosystem/subgraphs/overview
- Polygon contracts: https://docs.uniswap.org/contracts/v4/deployments
- GeckoTerminal: https://api.geckoterminal.com/api/v2/networks/polygon_pos/pools/multi/<poolId>,<poolId>
- Working notes: `tasks/checkpoint-polygon-subgraph-research.md`, `tasks/checkpoint-research-onchain.md`, `tasks/checkpoint-research-providers.md`, `tasks/checkpoint-research-self-publish.md`, `tasks/checkpoint-backend-polygon.md`
