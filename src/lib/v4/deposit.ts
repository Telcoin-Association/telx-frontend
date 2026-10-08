import { formatUnits, parseUnits } from "viem";
import {
  getAmount0ForLiquidity,
  getAmount1ForLiquidity,
  getAmountsForLiquidity,
  getLiquidityForAmount0,
  getLiquidityForAmount1,
  getLiquidityForAmounts,
  getSqrtPriceAtTick,
} from "./liquidityMath";
import { withSlippage, type TickRange } from "./range";

/**
 * A deposit into a range at the pool's current price: the visitor types one token's amount, the other follows from
 * the range, and the liquidity both pay for sets what the mint takes. Amounts are raw token units.
 */

export type DepositSide = 0 | 1;

/**
 * The other token's amount for `amount` of token `side` in `range` at `sqrtPriceX96`, rounded up (what the mint
 * takes). Zero when the range holds only one token at this price.
 */
export function otherAmount(side: DepositSide, amount: bigint, range: TickRange, sqrtPriceX96: bigint): bigint {
  const sqrtA = getSqrtPriceAtTick(range.tickLower);
  const sqrtB = getSqrtPriceAtTick(range.tickUpper);
  if (sqrtPriceX96 <= sqrtA || sqrtPriceX96 >= sqrtB) return 0n;
  if (side === 0) return getAmount1ForLiquidity(sqrtA, sqrtPriceX96, getLiquidityForAmount0(sqrtPriceX96, sqrtB, amount), true);
  return getAmount0ForLiquidity(sqrtPriceX96, sqrtB, getLiquidityForAmount1(sqrtA, sqrtPriceX96, amount), true);
}

export type DepositPlan = { liquidity: bigint; amount0: bigint; amount1: bigint; amount0Max: bigint; amount1Max: bigint };

const BPS = 10_000n;

/** floor(sqrt(n)) for a non-negative bigint, by Newton's method from above. */
function sqrtFloor(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

/**
 * The sqrt prices of the pool price moved down and up by `slippageBps`: sqrt(P * (1 - s)) and sqrt(P * (1 + s)) as
 * Q64.96. Each is rounded away from the current price, so the band is never narrower than the slippage.
 */
export function slippageSqrtPrices(sqrtPriceX96: bigint, slippageBps: number): { lower: bigint; upper: bigint } {
  const bps = BigInt(Math.max(0, Math.round(slippageBps)));
  const squared = sqrtPriceX96 * sqrtPriceX96;
  const lower = bps >= BPS ? 0n : sqrtFloor((squared * (BPS - bps)) / BPS);
  const raised = squared * (BPS + bps);
  const upperSquared = raised / BPS + (raised % BPS === 0n ? 0n : 1n);
  const root = sqrtFloor(upperSquared);
  return { lower, upper: root * root === upperSquared ? root : root + 1n };
}

const clamp = (value: bigint, low: bigint, high: bigint) => (value < low ? low : value > high ? high : value);
const larger = (a: bigint, b: bigint) => (a > b ? a : b);
const smaller = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * The most a mint or increase of `liquidity` in `range` may take of each token while the pool price stays within
 * `slippageBps` of `sqrtPriceX96`, the bound Uniswap's SDK puts on a mint (`mintAmountsWithSlippage`): token0 is what
 * the liquidity holds at the lowest price of that band, token1 what it holds at the highest. The band is clamped to
 * the range, amounts round up as the PoolManager charges them, and neither is below what the mint takes at
 * `sqrtPriceX96`.
 *
 * The bound is on the price rather than on the amounts: near the edge of a narrow range a small price move shifts
 * the token mix by many times its own size, so a percentage on top of each amount would not cover it.
 */
export function maxAmountsForLiquidity(
  range: TickRange,
  sqrtPriceX96: bigint,
  liquidity: bigint,
  slippageBps: number,
): { amount0Max: bigint; amount1Max: bigint } {
  const sqrtA = getSqrtPriceAtTick(range.tickLower);
  const sqrtB = getSqrtPriceAtTick(range.tickUpper);
  const needed = getAmountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, liquidity, true);
  const band = slippageSqrtPrices(sqrtPriceX96, slippageBps);
  return {
    amount0Max: larger(getAmount0ForLiquidity(clamp(band.lower, sqrtA, sqrtB), sqrtB, liquidity, true), needed.amount0),
    amount1Max: larger(getAmount1ForLiquidity(sqrtA, clamp(band.upper, sqrtA, sqrtB), liquidity, true), needed.amount1),
  };
}

/**
 * The liquidity `amount0` and `amount1` pay for in `range`, what the mint takes for it at the current price, and the
 * most it may take while the price stays within `slippageBps` (see maxAmountsForLiquidity). Null when the amounts
 * buy no liquidity.
 */
export function planDeposit(range: TickRange, sqrtPriceX96: bigint, amount0: bigint, amount1: bigint, slippageBps: number): DepositPlan | null {
  const sqrtA = getSqrtPriceAtTick(range.tickLower);
  const sqrtB = getSqrtPriceAtTick(range.tickUpper);
  const liquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtA, sqrtB, amount0, amount1);
  if (liquidity <= 0n) return null;
  const needed = getAmountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, liquidity, true);
  return { liquidity, amount0: needed.amount0, amount1: needed.amount1, ...maxAmountsForLiquidity(range, sqrtPriceX96, liquidity, slippageBps) };
}

export type DepositLimits = { amount0Max: bigint; amount1Max: bigint; short: DepositSide[] };

/**
 * A plan's maximum amounts capped at what the wallet can spend of each token: `spendable` is the balance, less the
 * gas reserve for native ETH, whose maximum is also the call's value (the PositionManager sweeps back what the mint
 * leaves). A token can't be paid beyond the balance anyway, so the cap never stops an add that could succeed.
 *
 * A side is short when the cap would leave less than its amount plus `slippageBps`, or less than its uncapped
 * maximum when that is smaller: too little room for the price to move, so the add is not offered.
 */
export function capToBalances(plan: DepositPlan, spendable: readonly [bigint, bigint], slippageBps: number): DepositLimits {
  const short: DepositSide[] = [];
  const cap = (side: DepositSide, needed: bigint, max: bigint): bigint => {
    if (spendable[side] < smaller(max, withSlippage(needed, slippageBps))) {
      short.push(side);
      return max;
    }
    return smaller(max, spendable[side]);
  };
  return { amount0Max: cap(0, plan.amount0, plan.amount0Max), amount1Max: cap(1, plan.amount1, plan.amount1Max), short };
}

/** A typed amount in raw units, or null when it is not a valid non-negative number. Extra decimals are dropped. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole, fraction = ""] = trimmed.split(".");
  try {
    return parseUnits(`${whole || "0"}.${fraction.slice(0, decimals) || "0"}`, decimals);
  } catch {
    return null;
  }
}

/** A raw amount as editable text, with at most `maxDecimals` decimals and no trailing zeros. */
export function amountText(amount: bigint, decimals: number, maxDecimals = 8): string {
  const [whole, fraction = ""] = formatUnits(amount, decimals).split(".");
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
