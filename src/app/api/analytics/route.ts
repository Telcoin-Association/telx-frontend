import { apiPreviewRejection } from "@/helpers/previewAuth";
import { SHARED_CACHE_CONTROL, sharedCacheControl } from "@/lib/cacheControl";
import { readAnalytics } from "@/server/analytics/series";

export const dynamic = "force-dynamic";

/**
 * The analytics series for the public dashboard: every active Uniswap pool's daily figures and Merkl rewards
 * history, the campaigns seen, and TEL's daily price. The body is the same for every visitor and changes at most
 * every few minutes, so it is cached at the edge. 502, not cached, when the cache can't be read.
 */
export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;

  try {
    const body = await readAnalytics();
    return Response.json(body, { headers: { "Cache-Control": sharedCacheControl(SHARED_CACHE_CONTROL) } });
  } catch (err) {
    console.error("Analytics read failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Analytics are unavailable right now." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
