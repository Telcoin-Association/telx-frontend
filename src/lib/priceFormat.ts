// Prices span many orders of magnitude (TEL per WETH is about a million, WETH per TEL a millionth, and a range
// bound near the edge of the tick space can sit 50 orders away from the pool price), so every price reads in a
// handful of characters with three significant digits:
//   - 0.0001 up to 10,000 in plain digits: "0.000859", "4,980";
//   - 10,000 up to 1,000T in compact notation: "1.16M", "338T";
//   - from 1,000T in scientific notation: "3.38e26";
//   - below 0.0001 with the run of zeros after the decimal point counted in subscript, as Uniswap shows small
//     prices: "0.0₅25" is 0.0000025 (five zeros, then the digits 25).
const SIGNIFICANT_DIGITS = 3;
const compactPrice = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: SIGNIFICANT_DIGITS });
const plainPrice = new Intl.NumberFormat("en-US", { maximumSignificantDigits: SIGNIFICANT_DIGITS });

/** Smallest magnitude shown in plain digits; anything smaller counts its leading zeros in subscript. */
const SMALLEST_PLAIN = 1e-4;
/** Smallest magnitude shown in compact notation. */
const SMALLEST_COMPACT = 10_000;
/** Smallest magnitude past the largest compact suffix (T), shown in scientific notation instead. */
const SMALLEST_SCIENTIFIC = 1e15;

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const subscript = (n: number) => String(n).replace(/\d/g, d => SUBSCRIPT_DIGITS[Number(d)]);

/** The significant digits and decimal exponent of a positive `value`, with trailing zeros dropped from the digits. */
function rounded(value: number, significantDigits: number): { digits: string; exponent: number } {
  const [mantissa, exponent] = value.toExponential(significantDigits - 1).split("e");
  return { digits: mantissa.replace(".", "").replace(/0+$/, "") || "0", exponent: Number(exponent) };
}

/** A positive value in scientific notation, for example 3.3849e26 as "3.38e26". */
function scientific(value: number, significantDigits: number): string {
  const { digits, exponent } = rounded(value, significantDigits);
  return `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${exponent}`;
}

/** A positive price below SMALLEST_PLAIN, for example 0.0000025 as "0.0₅25". */
function formatTiny(value: number): string {
  const { digits, exponent } = rounded(value, SIGNIFICANT_DIGITS);
  // Rounding can carry up to plain territory, as 0.000099999 does to 0.0001.
  if (10 ** exponent >= SMALLEST_PLAIN) return plainPrice.format(value);
  return `0.0${subscript(-exponent - 1)}${digits}`;
}

/** A pool price for display in a few characters at any magnitude, "∞" for positive infinity, or "Unavailable" when missing. */
export function formatPrice(value: number | null): string {
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  if (value === 0) return "0";
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  if (magnitude < SMALLEST_PLAIN) return sign + formatTiny(magnitude);
  // Compared after rounding, so 999.9T (which compact notation prints as "1000T") moves to scientific notation.
  if (Number(magnitude.toPrecision(SIGNIFICANT_DIGITS)) >= SMALLEST_SCIENTIFIC) return sign + scientific(magnitude, SIGNIFICANT_DIGITS);
  return sign + (magnitude >= SMALLEST_COMPACT ? compactPrice.format(magnitude) : plainPrice.format(magnitude));
}

/** Significant digits a price shows in a tooltip behind its compact figure. */
const DETAIL_DIGITS = 8;

/**
 * A price with more precision, for a tooltip behind a compact figure: plain digits between 1e-6 and 1e15 and
 * scientific notation outside, so it stays readable at any magnitude. Positive infinity reads "∞".
 */
export function formatPriceDetail(value: number | null): string {
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e-6 && magnitude < SMALLEST_SCIENTIFIC) return value.toLocaleString("en-US", { maximumSignificantDigits: DETAIL_DIGITS });
  return (value < 0 ? "-" : "") + scientific(magnitude, DETAIL_DIGITS);
}
