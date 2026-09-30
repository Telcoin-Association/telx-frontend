import { formatUnits, parseUnits } from "viem";

export type AmountInput = { status: "empty" } | { status: "invalid" } | { status: "valid"; value: bigint };

const WAD_DECIMALS = 18;
const AMOUNT_SHAPE = /^[0-9]*(?:\.([0-9]*))?$/;

/** Digits and one decimal point. A second dot is dropped instead of failing the parse. */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, "")}`;
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
