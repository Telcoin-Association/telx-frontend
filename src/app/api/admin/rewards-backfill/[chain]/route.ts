import { isRpcChain } from "@/lib/rpc";
import { checkBearer } from "@/server/pools/auth";
import { runRewardsBackfillJob } from "@/server/pools/merkl/backfillJob";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const HEADERS = { "Cache-Control": "no-store" };

/**
 * Backfill of the Merkl rewards history for one chain, behind `Authorization: Bearer ${CRON_SECRET}`: each
 * day from the chain's first campaign through today gets a row derived from the campaigns' funding and the
 * positions subscribed on chain (see src/server/pools/merkl/backfill.ts), unless the Merkl cron already
 * recorded that day. Each call works for up to 120 seconds and answers `{ done, nextDay, ... }`; repeat it
 * until `done` is true. A later call refreshes today and samples any day since. `?reset=1` starts again from
 * the first campaign, rereading the subscriptions; chain rows are rewritten and recorded rows are kept. The
 * preview login does not apply: the middleware lets `/api/admin/` through to this bearer check.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/admin/rewards-backfill/polygon
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

  const reset = new URL(request.url).searchParams.get("reset") === "1";
  const result = await runRewardsBackfillJob(chain, { reset });
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
