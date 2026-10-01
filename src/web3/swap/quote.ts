import { parseUnits, type Address, type Hex } from "viem";
import type { RpcChain } from "@/lib/rpc";

/** The body of a quote with liquidity from GET /api/swap/quote (see src/server/swap/zeroEx.ts). */
export type SwapQuote = {
  liquidityAvailable: true;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  allowance: { spender: Address; actual: string } | null;
  balanceShort: boolean;
  gas: string | null;
  gasPrice: string | null;
  sources: string[];
  transaction: { to: Address; data: Hex; value: string; gas: string | null } | null;
};

export type QuoteRequest = {
  chain: RpcChain;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  taker: Address | undefined;
  slippageBps: number;
};

export type QuoteOutcome =
  | { kind: "quote"; quote: SwapQuote; fetchedAt: number }
  | { kind: "no-liquidity" }
  | { kind: "error"; message: string; unavailable: boolean };

/** A quote older than this is fetched again before it can be sent: prices move, and 0x's quotes are short-lived. */
export const QUOTE_TTL_MS = 30_000;
/** While a quote is shown and no transaction is in flight, it is refreshed this often. */
export const QUOTE_REFRESH_MS = 15_000;

export const isQuoteFresh = (fetchedAt: number, now: number = Date.now()) => now - fetchedAt < QUOTE_TTL_MS;

/** The amount typed into the From field in the token's base units, or null when it is empty, malformed, zero or too precise. */
export function parseSellAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  try {
    const amount = parseUnits(trimmed, decimals);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

/** Fetches a quote from our route. The indicative price is fetched without a taker. */
export async function fetchQuote(request: QuoteRequest, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<QuoteOutcome> {
  const params = new URLSearchParams({
    chain: request.chain,
    sellToken: request.sellToken,
    buyToken: request.buyToken,
    sellAmount: request.sellAmount.toString(),
    slippageBps: String(request.slippageBps),
  });
  if (request.taker) params.set("taker", request.taker);
  let res: Response;
  try {
    res = await fetchImpl(`/api/swap/quote?${params}`);
  } catch {
    return { kind: "error", message: "The quote could not be loaded. Check your connection and try again.", unavailable: false };
  }
  const body = (await res.json().catch(() => null)) as { error?: string; liquidityAvailable?: boolean } | null;
  if (!res.ok) {
    return { kind: "error", message: body?.error ?? "The quote could not be loaded.", unavailable: res.status === 503 };
  }
  if (!body?.liquidityAvailable) return { kind: "no-liquidity" };
  return { kind: "quote", quote: body as SwapQuote, fetchedAt: now() };
}
