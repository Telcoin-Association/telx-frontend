/**
 * Shared helpers for Merkl reward formatting and USD conversion.
 */

import formatNumberToCurrencyString from "@/helpers/formatNumberToCurrencyString";
import { formatUnits } from "viem";

/** Convert raw token amount to human-readable string using token decimals */
export function formatMerklTokenAmount(
  amount: string,
  decimals: number
): string {
  return formatUnits(BigInt(amount || "0"), decimals);
}

/**
 * Compute USD value from Merkl's token.price field.
 * Merkl uses this price for their dashboard USD totals.
 */
export function merklAmountToUSD(
  amount: string,
  decimals: number,
  price?: number
): number {
  if (!price) return 0;
  const humanAmount = Number(formatUnits(BigInt(amount || "0"), decimals));
  return humanAmount * price;
}

/** Format a Merkl-derived USD value for display */
export function formatMerklUSD(value: number): string {
  return formatNumberToCurrencyString(value);
}

/** Truncate an address for compact display: 0xabcd...1234 */
export function truncateAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
