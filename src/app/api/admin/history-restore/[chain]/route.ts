import { checkBearer } from "@/server/pools/auth";
import { restoreHistory } from "@/server/pools/history/restore";
import { HISTORY_CHAINS, dayOfLabel } from "@/server/pools/history/store";
import type { Chain } from "@/server/pools/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const HEADERS = { "Cache-Control": "no-store" };

/**
 * Writes a chain's history back into Redis from the daily Blob export, behind
 * `Authorization: Bearer ${CRON_SECRET}`. Only fields Redis does not hold are written, so a restore never
 * replaces a newer row and can be repeated. `?day=YYYY-MM-DD` picks the export to restore the day rows from
 * (the newest when omitted); position changes come from every export up to that day. The preview login does
 * not apply: the middleware lets `/api/admin/` through to this bearer check.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/admin/history-restore/polygon?day=2026-10-01"
 */
export async function POST(request: Request, { params }: { params: Promise<{ chain: string }> }) {
  const auth = checkBearer(request.headers, "CRON_SECRET");
  if (!auth.ok) {
    const error = auth.status === 500 ? "Restore is not configured" : "Unauthorized";
    return Response.json({ error }, { status: auth.status, headers: HEADERS });
  }

  const { chain } = await params;
  if (!HISTORY_CHAINS.includes(chain as Chain)) {
    return Response.json({ error: "Unknown chain" }, { status: 404, headers: HEADERS });
  }

  const label = new URL(request.url).searchParams.get("day");
  const day = label === null ? null : dayOfLabel(label);
  if (label !== null && day === null) {
    return Response.json({ error: "day must be YYYY-MM-DD" }, { status: 400, headers: HEADERS });
  }

  const result = await restoreHistory(chain as Chain, day);
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
