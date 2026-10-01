import { MAX_TICK, MIN_TICK } from "./liquidityMath";

/**
 * Position ranges for the add-liquidity panel. Prices are currency1 per currency0 in whole-token units, the
 * orientation the pool page shows. A tick is log base 1.0001 of the raw price, so moving a price by a fraction p
 * moves its tick by log(1 + p) / log(1.0001).
 */

const LOG_TICK_BASE = Math.log(1.0001);

/** The narrowest range the panel accepts: at least this far below and above the current price. */
export const MIN_RANGE_HALF_WIDTH = 0.05;

export type RangePreset = "full" | "10" | "25";
export const RANGE_PRESETS: readonly RangePreset[] = ["full", "25", "10"];
export const RANGE_PRESET_LABEL: Readonly<Record<RangePreset, string>> = { full: "Full range", "25": "±25%", "10": "±10%" };
const PRESET_HALF_WIDTH: Readonly<Record<Exclude<RangePreset, "full">, number>> = { "10": 0.1, "25": 0.25 };

export type TickRange = { tickLower: number; tickUpper: number };

/** The lowest and highest ticks a position can use with this tick spacing. */
export function usableTickBounds(tickSpacing: number): TickRange {
  return { tickLower: Math.ceil(MIN_TICK / tickSpacing) * tickSpacing, tickUpper: Math.floor(MAX_TICK / tickSpacing) * tickSpacing };
}

/** The tick (not aligned, not rounded) at a whole-unit price of currency1 per currency0. */
export function tickAtPrice(price: number, decimals0: number, decimals1: number): number {
  return Math.log(price * 10 ** (decimals1 - decimals0)) / LOG_TICK_BASE;
}

/** The whole-unit price of currency1 per currency0 at `tick`. */
export function priceAtTick(tick: number, decimals0: number, decimals1: number): number {
  return Math.exp(tick * LOG_TICK_BASE) * 10 ** (decimals0 - decimals1);
}

const clampToBounds = (range: TickRange, tickSpacing: number): TickRange => {
  const bounds = usableTickBounds(tickSpacing);
  return { tickLower: Math.max(range.tickLower, bounds.tickLower), tickUpper: Math.min(range.tickUpper, bounds.tickUpper) };
};

/**
 * The range from a fraction below the current price to a fraction above it, widened outwards to the tick spacing,
 * so it always contains the current tick.
 */
function rangeAround(currentTick: number, below: number, above: number, tickSpacing: number): TickRange {
  const lower = currentTick + Math.log(1 - below) / LOG_TICK_BASE;
  const upper = currentTick + Math.log(1 + above) / LOG_TICK_BASE;
  return clampToBounds(
    { tickLower: Math.floor(lower / tickSpacing) * tickSpacing, tickUpper: Math.ceil(upper / tickSpacing) * tickSpacing },
    tickSpacing,
  );
}

/** A preset's ticks around the current tick. */
export function presetRange(preset: RangePreset, currentTick: number, tickSpacing: number): TickRange {
  if (preset === "full") return usableTickBounds(tickSpacing);
  return rangeAround(currentTick, PRESET_HALF_WIDTH[preset], PRESET_HALF_WIDTH[preset], tickSpacing);
}

/** A custom range from two prices, widened outwards to the tick spacing. Null when a price is not positive. */
export function customRange(lowerPrice: number, upperPrice: number, decimals0: number, decimals1: number, tickSpacing: number): TickRange | null {
  if (!(lowerPrice > 0) || !(upperPrice > 0) || !Number.isFinite(lowerPrice) || !Number.isFinite(upperPrice)) return null;
  const lower = tickAtPrice(lowerPrice, decimals0, decimals1);
  const upper = tickAtPrice(upperPrice, decimals0, decimals1);
  return clampToBounds(
    { tickLower: Math.floor(lower / tickSpacing) * tickSpacing, tickUpper: Math.ceil(upper / tickSpacing) * tickSpacing },
    tickSpacing,
  );
}

/** True when the range spans the pool's usable tick bounds. */
export const isFullRangeTicks = (range: TickRange, tickSpacing: number): boolean => {
  const bounds = usableTickBounds(tickSpacing);
  return range.tickLower <= bounds.tickLower && range.tickUpper >= bounds.tickUpper;
};

/**
 * Why a range cannot be used, or null when it can. A range must be aligned to the tick spacing, within the usable
 * bounds, contain the current tick (the TELx rewards subscriber rejects a position out of range), and reach at
 * least MIN_RANGE_HALF_WIDTH below and above the current price, so a new position does not drift out of range
 * moments after it is subscribed.
 */
export function rangeProblem(range: TickRange, currentTick: number, tickSpacing: number): string | null {
  const { tickLower, tickUpper } = range;
  const bounds = usableTickBounds(tickSpacing);
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) return "The range must follow the pool's tick spacing.";
  if (tickLower < bounds.tickLower || tickUpper > bounds.tickUpper) return "The range is outside what the pool allows.";
  if (tickLower >= tickUpper) return "The lower price must be below the upper price.";
  if (!(currentTick >= tickLower && currentTick < tickUpper)) return "The range must include the current price to earn TELx rewards.";
  const minimum = rangeAround(currentTick, MIN_RANGE_HALF_WIDTH, MIN_RANGE_HALF_WIDTH, tickSpacing);
  if (tickLower > minimum.tickLower || tickUpper < minimum.tickUpper) {
    return `The range must reach at least ${MIN_RANGE_HALF_WIDTH * 100}% below and above the current price.`;
  }
  return null;
}

/** `amount` plus slippage in basis points, rounded up: the most the position may take of a token. */
export function withSlippage(amount: bigint, slippageBps: number): bigint {
  const scaled = amount * BigInt(10_000 + Math.round(slippageBps));
  return scaled / 10_000n + (scaled % 10_000n === 0n ? 0n : 1n);
}
