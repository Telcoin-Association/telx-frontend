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

/**
 * The liquidity `amount0` and `amount1` pay for in `range`, what the mint takes for it at the current price, and the
 * most it may take after the price moves by `slippageBps`. Null when the amounts buy no liquidity.
 */
export function planDeposit(range: TickRange, sqrtPriceX96: bigint, amount0: bigint, amount1: bigint, slippageBps: number): DepositPlan | null {
  const sqrtA = getSqrtPriceAtTick(range.tickLower);
  const sqrtB = getSqrtPriceAtTick(range.tickUpper);
  const liquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtA, sqrtB, amount0, amount1);
  if (liquidity <= 0n) return null;
  const needed = getAmountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, liquidity, true);
  return {
    liquidity,
    amount0: needed.amount0,
    amount1: needed.amount1,
    amount0Max: withSlippage(needed.amount0, slippageBps),
    amount1Max: withSlippage(needed.amount1, slippageBps),
  };
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
