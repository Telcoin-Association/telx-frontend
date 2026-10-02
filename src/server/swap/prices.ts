import { isRpcChain, type RpcChain } from "@/lib/rpc";
import { isNative } from "@/web3/swap/tokens";

/*
 * USD prices for the Swap page, from DefiLlama's free coins API (no key). A token DefiLlama can't price with
 * confidence is left out, and the page shows "No USD price" for it; prices never block a swap.
 */

export const LLAMA_PRICES_URL = "https://coins.llama.fi/prices/current";
/** How long the CDN keeps an answer. DefiLlama refreshes most prices every few minutes. */
export const PRICE_CACHE_SECONDS = 60;
/** The most tokens one request may ask for; the page asks for two. */
export const MAX_PRICE_TOKENS = 10;
/** DefiLlama's confidence (0 to 1) below which a price is left out rather than shown. */
export const MIN_PRICE_CONFIDENCE = 0.8;
const FETCH_TIMEOUT_MS = 5_000;
/**
 * How far back DefiLlama may look for a token's latest price. Thinly traded tokens such as eMXN can go hours
 * between price updates; a narrower window leaves them unpriced.
 */
const SEARCH_WIDTH = "12h";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** DefiLlama names each chain's native token by the zero address. */
const LLAMA_NATIVE = "0x0000000000000000000000000000000000000000";

export type ParsedPricesQuery = { ok: true; chain: RpcChain; tokens: string[] } | { ok: false; error: string };

/** Checks `chain` and `tokens` (a comma-separated list of addresses, the native token included), lowercasing the addresses. */
export function parsePricesQuery(params: URLSearchParams): ParsedPricesQuery {
  const chain = params.get("chain") ?? "";
  if (!isRpcChain(chain)) return { ok: false, error: "chain must be ethereum, polygon or base" };
  const tokens = [...new Set((params.get("tokens") ?? "").split(",").map((token) => token.trim().toLowerCase()).filter(Boolean))];
  if (tokens.length === 0 || tokens.length > MAX_PRICE_TOKENS || !tokens.every((token) => ADDRESS.test(token))) {
    return { ok: false, error: `tokens must be 1 to ${MAX_PRICE_TOKENS} comma-separated addresses` };
  }
  return { ok: true, chain, tokens };
}

/** DefiLlama's id for a token: `<chain>:<address>`, with the native token as the zero address. */
export const llamaCoinId = (chain: RpcChain, token: string) => `${chain}:${isNative(token) ? LLAMA_NATIVE : token.toLowerCase()}`;

type LlamaAnswer = { coins?: Record<string, { price?: unknown; confidence?: unknown }> };

/**
 * The USD price of each token DefiLlama prices with enough confidence, keyed by the lowercase address asked for.
 * Throws when DefiLlama can't be reached or answers with an error.
 */
export async function fetchUsdPrices(chain: RpcChain, tokens: readonly string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, number>> {
  const ids = tokens.map((token) => llamaCoinId(chain, token));
  const response = await fetchImpl(`${LLAMA_PRICES_URL}/${ids.join(",")}?searchWidth=${SEARCH_WIDTH}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`DefiLlama answered ${response.status}`);
  const body = (await response.json()) as LlamaAnswer;
  // DefiLlama echoes ids as asked, but the lookup ignores case so a change there can't drop prices.
  const coins = new Map(Object.entries(body.coins ?? {}).map(([id, coin]) => [id.toLowerCase(), coin]));
  const prices: Record<string, number> = {};
  tokens.forEach((token, i) => {
    const coin = coins.get(ids[i]);
    const price = coin?.price;
    const confidence = typeof coin?.confidence === "number" ? coin.confidence : 1;
    if (typeof price === "number" && Number.isFinite(price) && price > 0 && confidence >= MIN_PRICE_CONFIDENCE) prices[token.toLowerCase()] = price;
  });
  return prices;
}
