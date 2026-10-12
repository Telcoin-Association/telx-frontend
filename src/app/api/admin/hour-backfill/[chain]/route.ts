import { isRpcChain } from "@/lib/rpc";
import { checkBearer } from "@/server/pools/auth";
import { MAX_HOUR_LIMIT, runHourBackfillJob } from "@/server/pools/rpc/hourBackfill";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const HEADERS = { "Cache-Control": "no-store" };

/** A positive whole number from a query parameter, or null when it is absent; undefined when it is not one. */
function wholeNumber(value: string | null): number | null | undefined {
  if (value === null) return null;
  if (!/^\d+$/.test(value) || Number(value) < 1) return undefined;
  return Number(value);
}

/**
 * Backfill of the hourly closing rows of one chain for the hours of the 30-day retention window that have none,
 * behind `Authorization: Bearer ${CRON_SECRET}` (see src/server/pools/rpc/hourBackfill.ts). Existing rows are
 * never replaced. Each call fills the newest `limit` missing hours (default 48, at most 720) below `before` (an
 * hour in unix seconds; the default is the cursor's hour), works for up to about 120 seconds, and answers
 * `{ hoursMissing, hoursToFill, hoursFilled, rowsWritten, rowsKept, next, done, ... }`. Repeat it with
 * `?before=<next>` until `done` is true. `?dryRun=1` answers the counts without any RPC call or write. Run Polygon
 * first, since Base and Ethereum take Polygon's hourly TEL price when they have no usable route. The preview login
 * does not apply: the middleware lets `/api/admin/` through to this bearer check.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/admin/hour-backfill/polygon?dryRun=1"
 */
export async function POST(request: Request, { params }: { params: Promise<{ chain: string }> }) {
  const auth = checkBearer(request.headers, "CRON_SECRET");
  if (!auth.ok) {
    const error = auth.status === 500 ? "Backfill is not configured" : "Unauthorized";
    return Response.json({ error }, { status: auth.status, headers: HEADERS });
  }

  const { chain } = await params;
  if (!isRpcChain(chain)) {
    return Response.json({ error: "Unknown chain" }, { status: 404, headers: HEADERS });
  }

  const search = new URL(request.url).searchParams;
  const limit = wholeNumber(search.get("limit"));
  const before = wholeNumber(search.get("before"));
  if (limit === undefined || (limit !== null && limit > MAX_HOUR_LIMIT)) {
    return Response.json({ error: `limit must be a whole number from 1 to ${MAX_HOUR_LIMIT}` }, { status: 400, headers: HEADERS });
  }
  if (before === undefined) {
    return Response.json({ error: "before must be an hour in unix seconds" }, { status: 400, headers: HEADERS });
  }

  const result = await runHourBackfillJob(chain, {
    dryRun: search.get("dryRun") === "1",
    ...(limit !== null && { limit }),
    ...(before !== null && { before }),
  });
  return Response.json(result.body, { status: result.status, headers: HEADERS });
}

function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { ...HEADERS, Allow: "POST" } });
}

export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
