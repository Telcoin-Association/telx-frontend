import { apiPreviewRejection } from "@/helpers/previewAuth";
import { fetchUsdPrices, parsePricesQuery, PRICE_CACHE_SECONDS } from "@/server/swap/prices";

const CACHED = { "Cache-Control": `public, s-maxage=${PRICE_CACHE_SECONDS}, stale-while-revalidate=${PRICE_CACHE_SECONDS * 2}` };
const UNCACHED = { "Cache-Control": "no-store" };

/**
 * USD prices for the Swap page's tokens, `{ prices: { <lowercase address>: number } }`. Prices are the same for every
 * visitor, so answers are cached at the CDN; a failed lookup is not cached and answers with no prices.
 */
export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;

  const parsed = parsePricesQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: UNCACHED });

  try {
    const prices = await fetchUsdPrices(parsed.chain, parsed.tokens);
    return Response.json({ prices }, { headers: CACHED });
  } catch (error) {
    console.warn("USD prices unavailable:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "USD prices are unavailable right now.", prices: {} }, { status: 502, headers: UNCACHED });
  }
}
