import { formatUnits, parseUnits } from "viem";

export type AmountInput = { status: "empty" } | { status: "invalid" } | { status: "valid"; value: bigint };

const WAD_DECIMALS = 18;
const AMOUNT_SHAPE = /^[0-9]*(?:\.([0-9]*))?$/;

/**
 * Keeps ASCII digits, "." and "," and never turns the text into a different number. A lone comma with no dot is
 * the decimal point, as a comma-locale decimal keypad types it; where it could also be a thousands separator the
 * smaller reading is the safe one. Any other mix of separators is kept as typed, so `parseAmountInput` reports it
 * invalid instead of the field guessing. Letters, signs, spaces and exponents are dropped.
 *
 *   "0,5" -> "0.5"            "1,234.5" -> "1,234.5" (invalid)      "1.2.3" -> "1.2.3" (invalid)
 *   "12,5" -> "12.5"          "1.000,50" -> "1.000,50" (invalid)    "1.000.000" -> "1.000.000" (invalid)
 *   "1,234" -> "1.234"        "1,234,567" -> "1,234,567" (invalid)  "12,50,1" -> "12,50,1" (invalid)
 *   "," -> "." (empty)        ",5" -> ".5"                          "0," -> "0."
 *   "1e5" -> "15"             " 1 000,50 USDC" -> "1000.50"
 */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.,]/g, "");
  return /^[0-9]*,[0-9]*$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned;
}

export function parseAmountInput(text: string, decimals: number): AmountInput {
  if (text === "" || text === ".") return { status: "empty" };
  const match = AMOUNT_SHAPE.exec(text);
  if (!match) return { status: "invalid" };
  // parseUnits would round extra fraction digits; the user should see the amount is too precise instead.
  if ((match[1] ?? "").length > decimals) return { status: "invalid" };
  return { status: "valid", value: parseUnits(text, decimals) };
}

function wadScale(decimals: number): bigint {
  if (decimals > WAD_DECIMALS) throw new RangeError(`Token decimals ${decimals} exceed ${WAD_DECIMALS}`);
  return 10n ** BigInt(WAD_DECIMALS - decimals);
}

export function toWad(amountIn: bigint, decimals: number): bigint {
  return amountIn * wadScale(decimals);
}

/**
 * The largest amount the form may offer, as the text typing it would produce. Caps are WAD on the input amount
 * and 0 means off; a cap converts to token units rounding down, since an amount equal to the cap is allowed.
 * The vault swaps 1:1 before fees, so the output reserve bounds the input directly.
 */
export function maxAmountInput(
  a: Readonly<{ balanceIn: bigint; maxPerTransaction: bigint; maxPerBlock: bigint; outputReserve?: bigint; decimals: number }>
): string {
  const scale = wadScale(a.decimals);
  const limits = [a.balanceIn];
  for (const cap of [a.maxPerTransaction, a.maxPerBlock]) {
    if (cap !== 0n) limits.push(cap / scale);
  }
  if (a.outputReserve !== undefined) limits.push(a.outputReserve);
  const max = limits.reduce((lowest, limit) => (limit < lowest ? limit : lowest));
  return formatUnits(max < 0n ? 0n : max, a.decimals);
}
