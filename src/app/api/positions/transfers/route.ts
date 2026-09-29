import type { NextRequest } from "next/server";
import { apiPreviewRejection } from "@/helpers/previewAuth";
import { perBlockCacheControl, sharedCacheControl } from "@/lib/cacheControl";
import { BLOCK_TIME_MS, transferFeedUrl } from "@/lib/positions";
import { isRpcChain } from "@/lib/rpc";
import { readTransferFeed } from "@/server/positions/transfers";
import { describeError } from "../../backendHelpers/errors";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** A redirect to the canonical URL never changes, so the edge keeps it for a day. */
const REDIRECT_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

/**
 * GET /api/positions/transfers?chain=polygon|base|ethereum
 *
 * Every Uniswap v4 PositionManager transfer on the chain over the last few minutes, plus the head block
 * (see TransferFeed in src/lib/positions.ts). The body is the same for every visitor, so the edge serves
 * it and the chain is read about once per block per chain however many visitors poll. Any query other
 * than exactly `?chain=<chain>` is redirected to that URL, so extra parameters cannot open new cache
 * entries that each read the chain.
 */
export async function GET(request: NextRequest) {
  const previewRejected = await apiPreviewRejection(request);
  if (previewRejected) return previewRejected;

  const chain = request.nextUrl.searchParams.get("chain");
  if (!chain || !isRpcChain(chain)) {
    return Response.json({ error: "Unknown chain" }, { status: 400, headers: NO_STORE });
  }

  const canonical = transferFeedUrl(chain);
  if (`${request.nextUrl.pathname}${request.nextUrl.search}` !== canonical) {
    return new Response(null, {
      status: 308,
      headers: { Location: canonical, "Cache-Control": sharedCacheControl(REDIRECT_CACHE_CONTROL) },
    });
  }

  try {
    const feed = await readTransferFeed(chain);
    return Response.json(feed, { headers: { "Cache-Control": sharedCacheControl(perBlockCacheControl(BLOCK_TIME_MS[chain])) } });
  } catch (error) {
    console.error(`Position transfer feed for ${chain} failed:`, describeError(error));
    return Response.json({ error: "Transfer feed unavailable" }, { status: 502, headers: NO_STORE });
  }
}
