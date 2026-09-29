import { apiPreviewRejection } from "@/helpers/previewAuth";
import { PARTIAL_CACHE_CONTROL, SHARED_CACHE_CONTROL, sharedCacheControl } from "@/lib/cacheControl";
import { readAllGrouped } from "@/server/pools/groupedRead";

export const dynamic = "force-dynamic";

/**
 * Pool data for every group the registry fetches, read from the cache in-process. The body is the
 * same for every visitor, so a complete response is cached at the edge; each group's `fetchedAt` keeps
 * the freshness note honest. Failed groups are listed in `failed`. A group that is `"unavailable"` has no
 * cached data and only changes when its cron next writes (every 5 minutes at most), so it does not
 * shorten the cache. A read `"error"` is transient, so that response is cached only briefly. 503, not
 * cached, when no group could be read.
 */
export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;

  const body = await readAllGrouped();
  const failed = Object.keys(body.failed).length;
  const loaded = Object.keys(body.groups).length;

  if (loaded === 0 && failed > 0) {
    return Response.json(body, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const readError = Object.values(body.failed).includes("error");
  return Response.json(body, { headers: { "Cache-Control": sharedCacheControl(readError ? PARTIAL_CACHE_CONTROL : SHARED_CACHE_CONTROL) } });
}
