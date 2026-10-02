import { MAX_TICK, MIN_TICK } from "./liquidityMath";

/**
 * Position ranges for the add-liquidity panel. Prices are currency1 per currency0 in whole-token units, the
 * orientation the pool page shows. A tick is log base 1.0001 of the raw price, so moving a price by a fraction p
 * moves its tick by log(1 + p) / log(1.0001).
 */

const LOG_TICK_BASE = Math.log(1.0001);

export type RangePreset = "full" | "25" | "10" | "5" | "1" | "0.5" | "0.1";
const PRESET_HALF_WIDTH: Readonly<Record<Exclude<RangePreset, "full">, number>> = {
  "25": 0.25,
  "10": 0.1,
  "5": 0.05,
  "1": 0.01,
  "0.5": 0.005,
  "0.1": 0.001,
};
export const RANGE_PRESET_LABEL: Readonly<Record<RangePreset, string>> = {
  full: "Full range",
  "25": "±25%",
  "10": "±10%",
  "5": "±5%",
  "1": "±1%",
  "0.5": "±0.5%",
  "0.1": "±0.1%",
};

/**
 * How narrow a pool's ranges may be. A stable pair's price barely moves, so its ranges may be as narrow as one
 * tick spacing around the current price; a volatile pair must reach at least `minHalfWidth` below and above it.
 * Ranges narrower than `narrowBelow` on either side get a warning, since they leave the price sooner and a position
 * out of range earns no fees and no TELx rewards.
 */
export type RangeProfile = {
  kind: "stable" | "volatile";
  presets: readonly RangePreset[];
  /** The range a switch to Custom starts from when the current range is full. */
  customStart: Exclude<RangePreset, "full">;
  minHalfWidth: number;
  narrowBelow: number;
};

export const VOLATILE_RANGE_PROFILE: RangeProfile = { kind: "volatile", presets: ["full", "25", "10", "5"], customStart: "10", minHalfWidth: 0.01, narrowBelow: 0.05 };
export const STABLE_RANGE_PROFILE: RangeProfile = { kind: "stable", presets: ["full", "1", "0.5", "0.1"], customStart: "1", minHalfWidth: 0, narrowBelow: 0.005 };

/** Pools whose two tokens are both stablecoins, by pool id: Polygon eUSD/eMXN. */
export const STABLE_PAIR_POOL_IDS: ReadonlySet<string> = new Set(["0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135"]);

/** The range rules for a pool; any pool not listed as a stable pair is volatile. */
export const rangeProfile = (poolId: string | undefined): RangeProfile =>
  poolId && STABLE_PAIR_POOL_IDS.has(poolId.trim().toLowerCase()) ? STABLE_RANGE_PROFILE : VOLATILE_RANGE_PROFILE;

/** A fraction as a percentage without trailing zeros: 0.005 is "0.5%". */
export const formatHalfWidth = (fraction: number): string => `${Number((fraction * 100).toFixed(3))}%`;

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
 * How far the range reaches below and above the current price, as fractions of it: 0.01 is 1%. Each is at least 0
 * for a range containing the current tick.
 */
export function rangeHalfWidths(range: TickRange, currentTick: number): { below: number; above: number } {
  return {
    below: 1 - Math.exp((range.tickLower - currentTick) * LOG_TICK_BASE),
    above: Math.exp((range.tickUpper - currentTick) * LOG_TICK_BASE) - 1,
  };
}

/** True when a usable range is narrow enough to warn about under the pool's rules. Full range never is. */
export function isNarrowRange(range: TickRange, currentTick: number, tickSpacing: number, profile: RangeProfile): boolean {
  if (isFullRangeTicks(range, tickSpacing)) return false;
  const { below, above } = rangeHalfWidths(range, currentTick);
  return Math.min(below, above) < profile.narrowBelow;
}

/**
 * Why a range cannot be used, or null when it can. A range must be aligned to the tick spacing, within the usable
 * bounds, and contain the current tick (the TELx rewards subscriber rejects a position out of range). It must also
 * reach the pool's minimum half width below and above the current price, widened to the tick spacing; a minimum of
 * 0 allows a single tick spacing around the current price.
 */
export function rangeProblem(range: TickRange, currentTick: number, tickSpacing: number, minHalfWidth = VOLATILE_RANGE_PROFILE.minHalfWidth): string | null {
  const { tickLower, tickUpper } = range;
  const bounds = usableTickBounds(tickSpacing);
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) return "The range must follow the pool's tick spacing.";
  if (tickLower < bounds.tickLower || tickUpper > bounds.tickUpper) return "The range is outside what the pool allows.";
  if (tickLower >= tickUpper) return "The lower price must be below the upper price.";
  if (!(currentTick >= tickLower && currentTick < tickUpper)) return "The range must include the current price to earn TELx rewards.";
  if (minHalfWidth > 0) {
    const minimum = rangeAround(currentTick, minHalfWidth, minHalfWidth, tickSpacing);
    if (tickLower > minimum.tickLower || tickUpper < minimum.tickUpper) {
      return `The range must reach at least ${formatHalfWidth(minHalfWidth)} below and above the current price.`;
    }
  }
  return null;
}

/** `amount` plus slippage in basis points, rounded up: the most the position may take of a token. */
export function withSlippage(amount: bigint, slippageBps: number): bigint {
  const scaled = amount * BigInt(10_000 + Math.round(slippageBps));
  return scaled / 10_000n + (scaled % 10_000n === 0n ? 0n : 1n);
}
