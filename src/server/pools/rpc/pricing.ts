import "server-only";

import { priceOfToken0InToken1 } from "./liquidityMath";
import { FEED_GRACE_SECONDS, TEL, type ChainConfig } from "./chains";
import type { ChainSnapshot } from "./snapshot";
import type { RpcPool } from "../registry";

/**
 * USD prices of a chain's tokens at one snapshot block.
 *
 * - Feed tokens (ETH, WETH, eMXN) take the chain's Chainlink answer. An answer at or below zero, or older than
 *   the feed's heartbeat plus FEED_GRACE_SECONDS, gives way to the last stored price, flagged stale.
 * - eUSD is fixed at $1. On Polygon the price implied by the eUSD/eMXN pool and MXN/USD is recorded, with a
 *   warning past PEG_WARN.
 * - TEL: every TEL pool on the chain gives a route price, its pool price times the other token's price. Routes
 *   whose other side holds under MIN_ROUTE_USD are dropped, and TEL is the median of the rest (the mean of
 *   two). A move of more than MAX_MOVE from the last stored TEL price is clamped and flagged. With no usable
 *   route a chain takes Polygon's latest TEL price, then Merkl's, then its own last price, flagged stale; with
 *   none of these, the median of the thin routes, flagged stale. Otherwise Merkl's price is only a check: a
 *   route price more than MERKL_WARN away from it is reported.
 * A token left without any price is missing, and the run that needs it fails rather than publish a guess.
 */

export const MIN_ROUTE_USD = 5_000;
/** A route price further than this from Merkl's is reported. */
export const MERKL_WARN = 0.1;
export const MAX_MOVE = 0.2;
export const PEG_WARN = 0.03;

export type PriceSource = "feed" | "fixed" | "pools" | "last" | "polygon" | "merkl";

export type TokenPrice = { usd: number; source: PriceSource; stale?: boolean; clamped?: boolean };

export type TelRoute = { poolId: string; usd: number; otherSideUsd: number; used: boolean };

export type ChainPrices = {
  /** Keyed by lowercase token address. A token without any price is absent. */
  tokens: Record<string, TokenPrice>;
  telRoutes: TelRoute[];
  impliedEusd: number | null;
  warnings: string[];
};

export type PricingInput = {
  config: ChainConfig;
  pools: readonly RpcPool[];
  snapshot: ChainSnapshot;
  /** Reserves per pool id (lens or position sum), used for the thin-route check. */
  reserves: Readonly<Record<string, { amount0: bigint; amount1: bigint } | null>>;
  /** Prices stored by the previous run, by token address. */
  last: Readonly<Record<string, number>>;
  /** Polygon's latest stored TEL price, for chains with no usable TEL route. */
  polygonTel: number | null;
  /** Merkl's TEL price, when this run fetched one. */
  merklTel?: number | null;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function priceChain(input: PricingInput): ChainPrices {
  const { config, pools, snapshot, reserves, last, polygonTel } = input;
  const merklTel = input.merklTel ?? null;
  const tokens: Record<string, TokenPrice> = {};
  const warnings: string[] = [];
  const label = `${config.chain} prices`;

  const fallback = (address: string, symbol: string, why: string) => {
    const previous = last[address];
    if (previous > 0) {
      tokens[address] = { usd: previous, source: "last", stale: true };
      warnings.push(`${label}: ${symbol} ${why}; using the last stored price`);
    } else {
      warnings.push(`${label}: ${symbol} ${why} and no stored price`);
    }
  };

  for (const [address, token] of Object.entries(config.tokens)) {
    if (token.price.kind === "fixedUsd") tokens[address] = { usd: token.price.usd, source: "fixed" };
    if (token.price.kind !== "feed") continue;
    const feed = config.feeds[token.price.feed];
    const round = snapshot.feeds[token.price.feed];
    if (!feed || !round) {
      fallback(address, token.symbol, `feed ${token.price.feed} did not answer`);
      continue;
    }
    const usd = Number(round.answer) / 10 ** feed.decimals;
    const age = snapshot.timestamp - round.updatedAt;
    if (!(usd > 0)) fallback(address, token.symbol, `feed ${token.price.feed} answered ${usd}`);
    else if (age > feed.heartbeatSeconds + FEED_GRACE_SECONDS) fallback(address, token.symbol, `feed ${token.price.feed} is ${age}s old`);
    else tokens[address] = { usd, source: "feed" };
  }

  // TEL routes.
  const telRoutes: TelRoute[] = [];
  for (const pool of pools) {
    const telIndex = pool.key.currency0 === TEL ? 0 : pool.key.currency1 === TEL ? 1 : -1;
    if (telIndex < 0) continue;
    const other = telIndex === 0 ? pool.key.currency1 : pool.key.currency0;
    const otherPrice = tokens[other]?.usd;
    const slot0 = snapshot.pools[pool.id]?.slot0;
    const otherToken = config.tokens[other];
    if (otherPrice === undefined || !slot0 || !otherToken) continue;
    const telToken = config.tokens[TEL];
    const [d0, d1] = telIndex === 0 ? [telToken.decimals, otherToken.decimals] : [otherToken.decimals, telToken.decimals];
    const oneInZero = priceOfToken0InToken1(slot0.sqrtPriceX96, d0, d1);
    if (oneInZero === null) continue;
    const usd = telIndex === 0 ? oneInZero * otherPrice : otherPrice / oneInZero;
    const held = reserves[pool.id];
    const otherAmount = held ? (telIndex === 0 ? held.amount1 : held.amount0) : 0n;
    const otherSideUsd = (Number(otherAmount) / 10 ** otherToken.decimals) * otherPrice;
    telRoutes.push({ poolId: pool.id, usd, otherSideUsd, used: otherSideUsd >= MIN_ROUTE_USD });
  }

  if (config.tokens[TEL]) {
    const usable = telRoutes.filter(route => route.used).map(route => route.usd);
    const previous = last[TEL];
    if (usable.length) {
      let usd = median(usable);
      let clamped = false;
      if (previous > 0 && Math.abs(usd / previous - 1) > MAX_MOVE) {
        const bounded = Math.min(previous * (1 + MAX_MOVE), Math.max(previous * (1 - MAX_MOVE), usd));
        warnings.push(`${label}: TEL moved from ${previous} to ${usd} in one run; clamped to ${bounded}`);
        usd = bounded;
        clamped = true;
      }
      tokens[TEL] = { usd, source: "pools", ...(clamped && { clamped }) };
      if (merklTel !== null && merklTel > 0 && Math.abs(usd / merklTel - 1) > MERKL_WARN) {
        warnings.push(`${label}: TEL route price ${usd} is ${((usd / merklTel - 1) * 100).toFixed(1)}% from Merkl's ${merklTel}`);
      }
    } else if (config.chain !== "polygon" && polygonTel !== null && polygonTel > 0) {
      tokens[TEL] = { usd: polygonTel, source: "polygon", stale: true };
      warnings.push(`${label}: no TEL route holds $${MIN_ROUTE_USD}; using Polygon's TEL price`);
    } else if (merklTel !== null && merklTel > 0) {
      tokens[TEL] = { usd: merklTel, source: "merkl", stale: true };
      warnings.push(`${label}: no TEL route holds $${MIN_ROUTE_USD}; using Merkl's TEL price`);
    } else if (previous > 0) {
      fallback(TEL, "TEL", `has no route holding $${MIN_ROUTE_USD}`);
    } else if (telRoutes.length) {
      // Nothing stored yet, as in the first chunks after a chain's pools were created: the thin routes are
      // all there is, and they are flagged rather than leaving the chain unpriced.
      tokens[TEL] = { usd: median(telRoutes.map(route => route.usd)), source: "pools", stale: true };
      warnings.push(`${label}: TEL priced from routes holding under $${MIN_ROUTE_USD}; nothing else is stored`);
    } else {
      warnings.push(`${label}: TEL has no route and no stored price`);
    }
  }

  // Implied eUSD: the eUSD/eMXN pool price times MXN/USD.
  let impliedEusd: number | null = null;
  const eusd = Object.keys(config.tokens).find(address => config.tokens[address].price.kind === "fixedUsd");
  const emxn = Object.keys(config.tokens).find(address => config.tokens[address].symbol === "eMXN");
  const pegPool =
    eusd &&
    emxn &&
    pools.find(
      pool =>
        [pool.key.currency0, pool.key.currency1].includes(eusd as `0x${string}`) &&
        [pool.key.currency0, pool.key.currency1].includes(emxn as `0x${string}`),
    );
  const mxn = emxn ? tokens[emxn] : undefined;
  const pegSlot0 = pegPool ? snapshot.pools[pegPool.id]?.slot0 : null;
  if (pegPool && mxn && pegSlot0 && eusd && emxn) {
    const eusdIs0 = pegPool.key.currency0 === eusd;
    const d = config.tokens;
    const oneInZero = priceOfToken0InToken1(pegSlot0.sqrtPriceX96, d[pegPool.key.currency0].decimals, d[pegPool.key.currency1].decimals);
    if (oneInZero !== null) {
      const emxnPerEusd = eusdIs0 ? oneInZero : 1 / oneInZero;
      impliedEusd = emxnPerEusd * mxn.usd;
      if (Math.abs(impliedEusd - 1) > PEG_WARN) warnings.push(`${label}: eUSD/eMXN implies eUSD at $${impliedEusd.toFixed(4)}`);
    }
  }

  return { tokens, telRoutes, impliedEusd, warnings };
}
