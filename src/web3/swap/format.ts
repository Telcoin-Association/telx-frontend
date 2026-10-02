/** The smallest magnitude shown as a number; anything smaller reads `<0.000001`. */
const SMALLEST_SHOWN = 0.000001;

/**
 * A token amount for display at `significant` significant digits, rounded down rather than to nearest. `value` is
 * an exact decimal string, as `formatUnits` returns, and is truncated as a string so no digit is ever rounded up: a
 * balance of 1233.6 reads 1,233, an amount the wallet can actually send.
 */
export function formatTokenAmountDown(value: string, significant = 4): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (amount === 0) return "0";
  const magnitude = Math.abs(amount);
  if (magnitude < SMALLEST_SHOWN) return "<0.000001";
  const digits = Math.max(0, significant - Math.floor(Math.log10(magnitude)) - 1);
  const negative = value.trim().startsWith("-");
  const [whole, fraction = ""] = value.trim().replace(/^[-+]/, "").split(".");
  const truncated = Number(`${negative ? "-" : ""}${whole}.${fraction.slice(0, digits) || "0"}`);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(truncated);
}
