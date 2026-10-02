import reportHistory from "@/data/report-history.json";
import { apiPreviewRejection } from "@/helpers/previewAuth";
import { sharedCacheControl } from "@/lib/cacheControl";

/**
 * The CDN keeps the report history for a day and serves it stale for a week while it revalidates: the file only
 * changes when the import script is rerun and the app redeployed.
 */
const ARCHIVE_CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";

/**
 * The TELx daily report's history (src/data/report-history.json, written by scripts/import-report-history.py),
 * in the file's compact form. The dashboard loads it only when the chosen range reaches before the app's own
 * history, and converts it with lib/analyticsArchive.ts.
 */
export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;
  return Response.json(reportHistory, { headers: { "Cache-Control": sharedCacheControl(ARCHIVE_CACHE_CONTROL) } });
}
