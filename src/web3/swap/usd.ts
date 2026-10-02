import { formatUnits } from "viem";
import type { RpcChain } from "@/lib/rpc";

/** How often the page refreshes its USD prices while visible; the route is cached for as long. */
export const USD_PRICE_REFRESH_MS = 60_000;
/** A swap that returns this much less in value than it sells is flagged. */
export const VALUE_LOSS_WARN_PCT = 1;
/** Past this the flag is strong. */
export const VALUE_LOSS_HIGH_PCT = 5;

/** USD prices by lowercase token address, from GET /api/swap/prices. A failed lookup gives no prices, never an error. */
export async function fetchSwapPrices(chain: RpcChain, tokens: readonly string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, number>> {
  const wanted = [...new Set(tokens.map((token) => token.toLowerCase()))];
  if (wanted.length === 0) return {};
  try {
    const res = await fetchImpl(`/api/swap/prices?${new URLSearchParams({ chain, tokens: wanted.join(",") })}`);
    if (!res.ok) return {};
    const body = (await res.json()) as { prices?: Record<string, unknown> } | null;
    return Object.fromEntries(Object.entries(body?.prices ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0));
  } catch {
    return {};
  }
}

/** The USD value of `amount` base units, or null without a price. */
export function usdValue(amount: bigint, decimals: number, price: number | undefined): number | null {
  if (price === undefined) return null;
  return Number(formatUnits(amount, decimals)) * price;
}

/** How much more (positive) or less (negative) the received value is than the sold value, in percent. */
export function valueChangePct(soldUsd: number | null, receivedUsd: number | null): number | null {
  if (soldUsd === null || receivedUsd === null || soldUsd <= 0) return null;
  return ((receivedUsd - soldUsd) / soldUsd) * 100;
}

export type ValueChangeLevel = "ok" | "warn" | "high";

/** Only a loss is flagged: past VALUE_LOSS_WARN_PCT, and strongly past VALUE_LOSS_HIGH_PCT. */
export function valueChangeLevel(pct: number | null): ValueChangeLevel {
  if (pct === null || pct >= -VALUE_LOSS_WARN_PCT) return "ok";
  return pct >= -VALUE_LOSS_HIGH_PCT ? "warn" : "high";
}

/** A signed percentage with two decimals: "+0.12%", "-0.42%", "0.00%". */
export function formatValueChange(pct: number): string {
  const rounded = Math.round(pct * 100) / 100;
  if (rounded === 0) return "0.00%";
  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toFixed(2)}%`;
}
