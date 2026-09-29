import type { Position } from "./positions";
import { isLegacyTel } from "./tokens";

/**
 * Pure helpers behind the positions list on a pool page: status, filtering, amount and USD formatting,
 * and the in-range check. Nothing here reads the chain or the network.
 */

export type PositionStatus = "subscribed" | "notSubscribed" | "closed";
export type PositionFilter = "all" | PositionStatus;

export const POSITION_FILTERS: readonly PositionFilter[] = ["all", "subscribed", "notSubscribed", "closed"];

export const STATUS_LABEL: Readonly<Record<PositionStatus, string>> = {
  subscribed: "Subscribed",
  notSubscribed: "Not subscribed",
  closed: "Closed",
};

export const FILTER_LABEL: Readonly<Record<PositionFilter, string>> = { all: "All", ...STATUS_LABEL };

/** A position with no liquidity is closed, whatever its subscription flag says. */
export function positionStatus(position: Pick<Position, "liquidity" | "isSubscribed">): PositionStatus {
  if (!(Number(position.liquidity) > 0)) return "closed";
  return position.isSubscribed ? "subscribed" : "notSubscribed";
}

/** Positions shown under a filter. "all" leaves closed positions out; they appear only under "closed". */
export function filterPositions<T extends Pick<Position, "liquidity" | "isSubscribed">>(positions: readonly T[], filter: PositionFilter): T[] {
  return positions.filter(position => {
    const status = positionStatus(position);
    return filter === "all" ? status !== "closed" : status === filter;
  });
}

/** How many positions each filter shows, so the chip counts always agree with the list. */
export function countPositions(positions: readonly Pick<Position, "liquidity" | "isSubscribed">[]): Record<PositionFilter, number> {
  const counts: Record<PositionFilter, number> = { all: 0, subscribed: 0, notSubscribed: 0, closed: 0 };
  for (const position of positions) {
    const status = positionStatus(position);
    counts[status] += 1;
    if (status !== "closed") counts.all += 1;
  }
  return counts;
}

const SMALLEST_SHOWN = 0.000001;

/**
 * A token amount rounded to `significant` digits for display: `0.000165854280435722` reads `0.0001659` and
 * `12.3456` reads `12.35`. Whole digits are never rounded away, so `1234567.8` reads `1,234,568`. Amounts
 * below 0.000001 read `<0.000001`. A value that is not a number is returned as given.
 */
export function formatTokenAmount(value: string | number, significant = 4): string {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);
  if (amount === 0) return "0";
  const magnitude = Math.abs(amount);
  if (magnitude < SMALLEST_SHOWN) return "<0.000001";
  if (magnitude < 1) return new Intl.NumberFormat("en-US", { maximumSignificantDigits: significant }).format(amount);
  const wholeDigits = Math.floor(Math.log10(magnitude)) + 1;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.max(0, significant - wholeDigits) }).format(amount);
}

/** A USD value with cents and thousands separators; a positive value under one cent reads `<$0.01`. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export type PoolAsset = { ticker?: string; address?: string | null };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Pool assets in currency0, currency1 order. Uniswap v4 sorts a pool's currencies by address, with native
 * ETH (a null address here) as the zero address, while the CMS lists assets in any order.
 */
export function orderPoolAssets<T extends PoolAsset>(assets: readonly T[] | undefined): T[] {
  const key = (asset: T) => (asset?.address ?? ZERO_ADDRESS).toLowerCase();
  return [...(assets ?? [])].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Market rates keyed by ticker, as GET /api/market-rate returns them. */
export type UsdRates = Record<string, { USD?: number } | undefined>;

/** Market rate tickers that stand in for a pool ticker: native ETH is priced as WETH. */
const RATE_TICKER: Readonly<Record<string, string>> = { ETH: "WETH" };

/**
 * The market rate of one pool asset. Legacy TEL has no rate of its own, since the TEL rate is for the
 * current token, so it is priced from its pool partner instead.
 */
function marketPrice(asset: PoolAsset | undefined, rates: UsdRates | undefined): number | undefined {
  if (!asset?.ticker || !rates || isLegacyTel(asset.address)) return undefined;
  const ticker = asset.ticker.toUpperCase();
  const entry = Object.entries(rates).find(([key]) => key.toUpperCase() === (RATE_TICKER[ticker] ?? ticker))?.[1];
  const price = entry?.USD;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : undefined;
}

/**
 * USD value of a position. Each currency is priced from the market rates; one without a rate is priced
 * from the other through the pool's own price. Returns null when neither currency has a rate, so the
 * caller can leave the value out rather than show a wrong one.
 */
export function positionUsdValue(
  position: Pick<Position, "amounts" | "price">,
  asset0: PoolAsset | undefined,
  asset1: PoolAsset | undefined,
  rates: UsdRates | undefined,
): number | null {
  let price0 = marketPrice(asset0, rates);
  let price1 = marketPrice(asset1, rates);
  const price1Per0 = Number(position.price?.price1Per0);
  const poolPriced = Number.isFinite(price1Per0) && price1Per0 > 0;

  if (price0 === undefined && price1 !== undefined && poolPriced) price0 = price1Per0 * price1;
  if (price1 === undefined && price0 !== undefined && poolPriced) price1 = price0 / price1Per0;
  if (price0 === undefined || price1 === undefined) return null;

  const amount0 = Number(position.amounts?.amount0);
  const amount1 = Number(position.amounts?.amount1);
  if (!Number.isFinite(amount0) || !Number.isFinite(amount1)) return null;
  return amount0 * price0 + amount1 * price1;
}

const LOG_TICK_BASE = Math.log(1.0001);

/**
 * Whether the pool's current price sits inside the position's range, read from the `sqrtPriceX96` the
 * positions route returns with each position. The pool's tick is the greatest tick at or below the price,
 * so a position is in range when `tickLower <= tick < tickUpper`. The comparison is made in floating point,
 * which is exact except for a price sitting on a range boundary to within a tiny fraction of a tick.
 * Returns null when the price is missing or unreadable.
 */
export function isPositionInRange(position: Pick<Position, "tickLower" | "tickUpper" | "amounts">): boolean | null {
  const raw = position.amounts?.sqrtPriceX96;
  if (!raw) return null;
  const sqrtPrice = Number(raw) / 2 ** 96;
  if (!Number.isFinite(sqrtPrice) || sqrtPrice <= 0) return null;
  const tick = (2 * Math.log(sqrtPrice)) / LOG_TICK_BASE;
  return tick >= position.tickLower && tick < position.tickUpper;
}
