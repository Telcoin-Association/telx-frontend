import { apiPreviewRejection } from "@/helpers/previewAuth";
import { PARTIAL_CACHE_CONTROL, SHARED_CACHE_CONTROL, sharedCacheControl } from "@/lib/cacheControl";
import { readAllGrouped } from "@/server/pools/groupedRead";

export const dynamic = "force-dynamic";

const POOLS_PATH = "/api/pools";

/**
 * Pool data for every group the registry fetches, read from the cache in-process. The body is the
 * same for every visitor, so a complete response is cached at the edge; each group's `fetchedAt` keeps
 * the freshness note honest. Failed groups are listed in `failed`. A group that is `"unavailable"` has no
 * cached data within its age limit and only changes when its cron next writes (every 5 minutes at most),
 * so it does not shorten the cache. A read `"error"` is transient, so that response is cached only briefly,
 * and so is one in which a loaded group's Merkl rewards are unknown (`rewardsUnavailable`), so the rewards
 * return as soon as they can be read. 503, not cached, when no group could be read.
 *
 * The CDN caches by full URL, so any query string would miss the cache and reach Redis. Such a request
 * gets a cacheable permanent redirect to the bare path instead, and never reads Redis.
 */
export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;

  if (new URL(request.url).search) {
    return new Response(null, { status: 308, headers: { Location: POOLS_PATH, "Cache-Control": sharedCacheControl(SHARED_CACHE_CONTROL) } });
  }

  const body = await readAllGrouped();
  const failed = Object.keys(body.failed).length;
  const loaded = Object.keys(body.groups).length;

  if (loaded === 0 && failed > 0) {
    return Response.json(body, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const readError = Object.values(body.failed).includes("error");
  const rewardsUnknown = Object.values(body.groups).some(group => group?.rewardsUnavailable);
  const partial = readError || rewardsUnknown;
  return Response.json(body, { headers: { "Cache-Control": sharedCacheControl(partial ? PARTIAL_CACHE_CONTROL : SHARED_CACHE_CONTROL) } });
}
