import { PARTIAL_CACHE_CONTROL, SHARED_CACHE_CONTROL } from "@/lib/cacheControl";
import { readAllGrouped } from "@/server/pools/groupedRead";

export const dynamic = "force-dynamic";

/**
 * Pool data for every group the registry fetches, read from the cache in-process. The body is the
 * same for every visitor, so a complete response is cached at the edge; each group's `fetchedAt` keeps
 * the freshness note honest. A response with a failed group lists it in `failed` and is cached only
 * briefly, so a recovered group appears within seconds. 503, not cached, when no group could be read.
 */
export async function GET() {
  const body = await readAllGrouped();
  const failed = Object.keys(body.failed).length;
  const loaded = Object.keys(body.groups).length;

  if (loaded === 0 && failed > 0) {
    return Response.json(body, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(body, { headers: { "Cache-Control": failed === 0 ? SHARED_CACHE_CONTROL : PARTIAL_CACHE_CONTROL } });
}
