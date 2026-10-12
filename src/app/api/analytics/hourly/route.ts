import { apiPreviewRejection } from "@/helpers/previewAuth";
import { SHARED_CACHE_CONTROL, sharedCacheControl } from "@/lib/cacheControl";
import { readHourlyAnalytics } from "@/server/analytics/series";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/hourly
 *
 * Every active Uniswap pool's hourly TVL, volume and fees for the last seven days, and TEL's hourly price (see
 * HourlyAnalyticsResponse in src/server/analytics/series.ts). The body is the same for every visitor and changes
 * at most every few minutes, so it is cached at the edge. 502, not cached, when the cache can't be read.
 */
export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;

  try {
    const body = await readHourlyAnalytics(Math.floor(Date.now() / 1000));
    return Response.json(body, { headers: { "Cache-Control": sharedCacheControl(SHARED_CACHE_CONTROL) } });
  } catch (err) {
    console.error("Hourly analytics read failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Hourly analytics are unavailable right now." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
