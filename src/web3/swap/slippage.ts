/** The preset slippage options, in basis points. */
export const SLIPPAGE_OPTIONS_BPS = [10, 50, 100] as const;
export const DEFAULT_SLIPPAGE_BPS = 50;
/** Above this a slippage is accepted with a warning. */
export const HIGH_SLIPPAGE_BPS = 200;
/** The largest slippage the quote route accepts. */
export const MAX_SLIPPAGE_BPS = 5_000;

/** Where the visitor's slippage choice is remembered in this browser. */
export const SLIPPAGE_STORAGE_KEY = "telx:swap:slippage";

export type SlippageChoice = { bps: number; custom: boolean };

export type ParsedSlippage = { ok: true; bps: number; high: boolean } | { ok: false; message: string };

/** A custom slippage typed as a percentage ("0.75" or "0,75"), in basis points, or why it can't be used. */
export function parseSlippagePercent(text: string): ParsedSlippage {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return { ok: false, message: "Enter a slippage percentage, such as 0.5." };
  const bps = Math.round(Number(trimmed) * 100);
  if (bps < 1) return { ok: false, message: "Slippage must be at least 0.01%." };
  if (bps > MAX_SLIPPAGE_BPS) return { ok: false, message: "Slippage can't be more than 50%." };
  return { ok: true, bps, high: bps > HIGH_SLIPPAGE_BPS };
}

/** The remembered slippage choice, or null when there is none or it can't be read. */
export function readSlippageChoice(storage: Pick<Storage, "getItem"> | undefined): SlippageChoice | null {
  try {
    const raw = storage?.getItem(SLIPPAGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SlippageChoice>;
    if (typeof parsed.bps !== "number" || !Number.isInteger(parsed.bps) || parsed.bps < 1 || parsed.bps > MAX_SLIPPAGE_BPS) return null;
    return { bps: parsed.bps, custom: parsed.custom === true };
  } catch {
    return null;
  }
}

/** Remembers the slippage choice; a browser that refuses storage keeps it for the visit only. */
export function writeSlippageChoice(storage: Pick<Storage, "setItem"> | undefined, choice: SlippageChoice): void {
  try {
    storage?.setItem(SLIPPAGE_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Storage can be full or blocked; the choice still applies to this visit.
  }
}

/** A basis-point slippage as the percentage the page shows, without trailing zeros. */
export const slippageLabel = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
