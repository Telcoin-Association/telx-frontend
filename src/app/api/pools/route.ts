import { SHARED_CACHE_CONTROL } from "@/lib/cacheControl";
import { readAllGrouped } from "@/server/pools/groupedRead";

export const dynamic = "force-dynamic";

/**
 * Pool data for every group the registry fetches, read from the cache in-process. The body is the
 * same for every visitor, so a complete response is cached at the edge; each group's `fetchedAt` keeps
 * the freshness note honest. A response with a failed group is not cached, so the next request retries
 * it, and the failed groups are listed in `failed`. 503 when no group could be read.
 */
export async function GET() {
  const body = await readAllGrouped();
  const failed = Object.keys(body.failed).length;
  const loaded = Object.keys(body.groups).length;

  const status = loaded === 0 && failed > 0 ? 503 : 200;
  return Response.json(body, { status, headers: { "Cache-Control": failed === 0 ? SHARED_CACHE_CONTROL : "no-store" } });
}
