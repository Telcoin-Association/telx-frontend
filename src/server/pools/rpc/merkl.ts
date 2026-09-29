import "server-only";

import { describeError } from "@/app/api/backendHelpers/errors";

import { TEL } from "./chains";

/**
 * Merkl's verified TEL price, an independent check on the pool-route TEL price. It feeds the payload only when
 * no route qualifies, and a failed or odd answer is only a warning.
 */

export const MERKL_TOKENS_URL = "https://api.merkl.xyz/v4/tokens/";
export const MERKL_TIMEOUT_MS = 3_000;

type MerklToken = { address?: unknown; price?: unknown };

/** TEL (TEL3) in USD on `chainId`, or null with the reason in `warning`. Never throws. */
export async function fetchMerklTelPrice(chainId: number, fetcher: typeof fetch = fetch): Promise<{ usd: number | null; warning?: string }> {
  const url = `${MERKL_TOKENS_URL}?chainId=${chainId}&symbol=TEL`;
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(MERKL_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return { usd: null, warning: `Merkl TEL price: HTTP ${res.status}` };
    const rows = (await res.json()) as unknown;
    const row = Array.isArray(rows)
      ? (rows as MerklToken[]).find(token => typeof token.address === "string" && token.address.toLowerCase() === TEL)
      : undefined;
    const usd = typeof row?.price === "number" && Number.isFinite(row.price) && row.price > 0 ? row.price : null;
    return usd === null ? { usd: null, warning: "Merkl TEL price: no TEL3 row with a price" } : { usd };
  } catch (err) {
    return { usd: null, warning: `Merkl TEL price: ${describeError(err)}` };
  }
}
