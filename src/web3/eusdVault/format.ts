import { formatUnits } from "viem";

/** Groups the integer part with commas and trims trailing fraction zeros. */
export function formatTokenAmount(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction.replace(/0+$/, "");

  return trimmedFraction ? `${groupedInteger}.${trimmedFraction}` : groupedInteger;
}

export function formatAmount(value: bigint, decimals: number): string {
  return formatTokenAmount(formatUnits(value, decimals));
}
