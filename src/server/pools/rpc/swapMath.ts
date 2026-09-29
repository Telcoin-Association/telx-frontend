import "server-only";

import { priceOfToken0InToken1 } from "./liquidityMath";
import type { SwapEvent } from "./logs";

/**
 * USD value of a v4 swap. Amounts follow v4's sign convention (see logs.ts): the negative amount is the
 * input. Fees are charged on the input, and the Swap event's `fee` already includes the protocol fee.
 */

export const PIPS_DENOMINATOR = 1_000_000;

/**
 * Slot0 `protocolFee` packs two 12-bit fees in pips: zeroForOne swaps in the low bits, oneForZero swaps in
 * the high bits. 2,048,500 is 500 each way; 512,125 is 125 each way.
 */
export function unpackProtocolFee(packed: number): { zeroForOne: number; oneForZero: number } {
  return { zeroForOne: packed & 0xfff, oneForZero: (packed >> 12) & 0xfff };
}

/** The swap fee v4 charges for a protocol fee and an LP fee, both in pips (ProtocolFeeLibrary.calculateSwapFee). */
export function composeSwapFee(protocolFee: number, lpFee: number): number {
  return protocolFee + lpFee - Math.floor((protocolFee * lpFee) / PIPS_DENOMINATOR);
}

/** The currency the swapper paid in and how much, fee included. Null when neither amount is negative. */
export function swapInput(swap: Pick<SwapEvent, "amount0" | "amount1">): { currency: 0 | 1; amount: bigint } | null {
  if (swap.amount0 < 0n) return { currency: 0, amount: -swap.amount0 };
  if (swap.amount1 < 0n) return { currency: 1, amount: -swap.amount1 };
  return null;
}

export type SwapValue = { volumeUSD: number; feesUSD: number; lpFeesUSD: number; protocolFeesUSD: number };

/**
 * USD prices of a swap's two currencies: the anchor at `anchorUsd`, the other currency through the pool
 * price after the swap. A chunk is priced at its last block, and the non-anchor token (TEL, eMXN) can move a
 * lot within a long chunk; its value at the swap keeps fees tied to the rate the swap traded at.
 */
export function swapPrices(sqrtPriceX96: bigint, anchor: 0 | 1, anchorUsd: number, decimals: readonly [number, number]): [number, number] {
  const oneInZero = priceOfToken0InToken1(sqrtPriceX96, decimals[0], decimals[1]);
  if (oneInZero === null) return anchor === 0 ? [anchorUsd, 0] : [0, anchorUsd];
  return anchor === 0 ? [anchorUsd, anchorUsd / oneInZero] : [anchorUsd * oneInZero, anchorUsd];
}

const abs = (value: bigint) => (value < 0n ? -value : value);
const units = (amount: bigint, decimals: number) => Number(amount) / 10 ** decimals;

/**
 * Volume is the anchor currency's amount at its price. Fees are `|input| x fee / 1e6` at the input's price
 * (see `swapPrices`); the protocol's share is `protocolPips / fee` of them, with the protocol fee of the
 * swap's direction taken from slot0, and the LP share is the rest.
 */
export function valueSwap(
  swap: Pick<SwapEvent, "amount0" | "amount1" | "fee">,
  anchor: 0 | 1,
  decimals: readonly [number, number],
  prices: readonly [number, number],
  protocolFee: number,
): SwapValue {
  const anchorAmount = anchor === 0 ? swap.amount0 : swap.amount1;
  const volumeUSD = units(abs(anchorAmount), decimals[anchor]) * prices[anchor];

  const input = swapInput(swap);
  if (!input || swap.fee === 0) return { volumeUSD, feesUSD: 0, lpFeesUSD: 0, protocolFeesUSD: 0 };
  const feesUSD = ((units(input.amount, decimals[input.currency]) * swap.fee) / PIPS_DENOMINATOR) * prices[input.currency];
  const { zeroForOne, oneForZero } = unpackProtocolFee(protocolFee);
  const protocolPips = Math.min(input.currency === 0 ? zeroForOne : oneForZero, swap.fee);
  const protocolFeesUSD = (feesUSD * protocolPips) / swap.fee;
  return { volumeUSD, feesUSD, lpFeesUSD: feesUSD - protocolFeesUSD, protocolFeesUSD };
}
