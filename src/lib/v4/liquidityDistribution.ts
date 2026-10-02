import { usableTickBounds, type TickRange } from "./range";

/**
 * How a v4 pool's liquidity is spread over prices, from its tick bitmap and the `liquidityNet` of each initialized
 * tick. A tick's bit lives in word `compressed >> 8` at bit `compressed & 255`, where `compressed` is the tick divided
 * by the tick spacing, rounded down. Crossing an initialized tick upwards adds its `liquidityNet` to the active
 * liquidity; crossing it downwards subtracts it.
 */

export type InitializedTick = { tick: number; liquidityNet: bigint };
export type LiquiditySegment = { tickLower: number; tickUpper: number; liquidity: bigint };

const compress = (tick: number, tickSpacing: number) => Math.floor(tick / tickSpacing);

/** The bitmap words that hold the ticks from `tickLower` to `tickUpper`. */
export function bitmapWords(tickLower: number, tickUpper: number, tickSpacing: number): number[] {
  const first = compress(tickLower, tickSpacing) >> 8;
  const last = compress(tickUpper, tickSpacing) >> 8;
  const words: number[] = [];
  for (let word = first; word <= last; word++) words.push(word);
  return words;
}

/** The initialized ticks a bitmap word marks. */
export function ticksInWord(word: number, bitmap: bigint, tickSpacing: number): number[] {
  const ticks: number[] = [];
  for (let bit = 0; bit < 256 && bitmap > 0n; bit++) {
    if ((bitmap >> BigInt(bit)) & 1n) ticks.push((word * 256 + bit) * tickSpacing);
  }
  return ticks;
}

/**
 * The active liquidity over `window`, as segments between initialized ticks. `activeLiquidity` is the liquidity at
 * `currentTick`; every initialized tick inside the window must be in `ticks`.
 */
export function liquiditySegments(window: TickRange, currentTick: number, activeLiquidity: bigint, ticks: readonly InitializedTick[]): LiquiditySegment[] {
  const inWindow = [...ticks].filter((t) => t.tick > window.tickLower && t.tick < window.tickUpper).sort((a, b) => a.tick - b.tick);
  const below: LiquiditySegment[] = [];
  const above: LiquiditySegment[] = [];

  let liquidity = activeLiquidity;
  let from = currentTick;
  for (const { tick, liquidityNet } of inWindow.filter((t) => t.tick > currentTick)) {
    above.push({ tickLower: from, tickUpper: tick, liquidity });
    liquidity += liquidityNet;
    from = tick;
  }
  above.push({ tickLower: from, tickUpper: window.tickUpper, liquidity });

  liquidity = activeLiquidity;
  let to = currentTick;
  for (const { tick, liquidityNet } of inWindow.filter((t) => t.tick <= currentTick).reverse()) {
    below.push({ tickLower: tick, tickUpper: to, liquidity });
    liquidity -= liquidityNet;
    to = tick;
  }
  below.push({ tickLower: window.tickLower, tickUpper: to, liquidity });

  return [...below.reverse(), ...above].filter((s) => s.tickUpper > s.tickLower && s.liquidity >= 0n);
}

/** Ticks either side of the price a chart shows for a full range position: a factor of two each way. */
const FULL_RANGE_VIEW_TICKS = 6_932;
/** The least a chart shows either side of the current price. */
const MIN_VIEW_TICKS = 1_000;

/**
 * The ticks a range chart shows: the range and the current price with room either side, or a factor of two around
 * the price for a full range. Aligned to the tick spacing and kept inside the usable bounds.
 */
export function chartWindow(range: TickRange, currentTick: number, tickSpacing: number, fullRange: boolean): TickRange {
  const bounds = usableTickBounds(tickSpacing);
  let lower: number;
  let upper: number;
  if (fullRange) {
    lower = currentTick - FULL_RANGE_VIEW_TICKS;
    upper = currentTick + FULL_RANGE_VIEW_TICKS;
  } else {
    lower = Math.min(range.tickLower, currentTick);
    upper = Math.max(range.tickUpper, currentTick);
    const pad = Math.max(Math.round((upper - lower) * 0.4), MIN_VIEW_TICKS);
    lower -= pad;
    upper += pad;
  }
  return {
    tickLower: Math.max(bounds.tickLower, Math.floor(lower / tickSpacing) * tickSpacing),
    tickUpper: Math.min(bounds.tickUpper, Math.ceil(upper / tickSpacing) * tickSpacing),
  };
}
