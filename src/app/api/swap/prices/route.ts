import { apiPreviewRejection } from "@/helpers/previewAuth";
import { TEL_TOKEN_ADDRESS } from "@/merkl/merklConstants";
import type { RpcRedis } from "@/server/pools/rpc/store";
import { fetchUsdPrices, parsePricesQuery, PRICE_CACHE_SECONDS, withOnchainTel } from "@/server/swap/prices";

const CACHED = { "Cache-Control": `public, s-maxage=${PRICE_CACHE_SECONDS}, stale-while-revalidate=${PRICE_CACHE_SECONDS * 2}` };
const UNCACHED = { "Cache-Control": "no-store" };

/**
 * The pool pipeline's on-chain TEL3 price, or undefined when it has none or can't be read. The Redis client and the
 * pipeline's chain config load only for a request that asks for TEL3.
 */
async function pipelineTelUsd(): Promise<number | undefined> {
  try {
    const [{ getRedis }, { pipelineRates }] = await Promise.all([import("@/server/pools/redis"), import("@/server/pools/rpc/pipelineRates")]);
    const usd = Number((await pipelineRates(getRedis() as unknown as RpcRedis)).TEL?.USD);
    return Number.isFinite(usd) && usd > 0 ? usd : undefined;
  } catch (error) {
    console.warn("Pipeline TEL price unavailable:", error instanceof Error ? error.message : "unknown error");
    return undefined;
  }
}

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
    const wantsTel = parsed.tokens.some((token) => token.toLowerCase() === TEL_TOKEN_ADDRESS.toLowerCase());
    const [llama, telUsd] = await Promise.all([fetchUsdPrices(parsed.chain, parsed.tokens), wantsTel ? pipelineTelUsd() : undefined]);
    const prices = withOnchainTel(llama, parsed.tokens, telUsd);
    return Response.json({ prices }, { headers: CACHED });
  } catch (error) {
    console.warn("USD prices unavailable:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "USD prices are unavailable right now.", prices: {} }, { status: 502, headers: UNCACHED });
  }
}
