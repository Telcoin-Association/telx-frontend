// Prices span many orders of magnitude (TEL per WETH is about a million, WETH per TEL a millionth), so they read
// compactly with three significant digits: "1.16M", "4,980", "0.000859".
const compactPrice = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });
const plainPrice = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });

/** A pool price for display, or "Unavailable" when it is missing. */
export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return Math.abs(value) >= 10_000 ? compactPrice.format(value) : plainPrice.format(value);
}
