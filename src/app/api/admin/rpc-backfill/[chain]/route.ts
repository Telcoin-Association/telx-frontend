import { isRpcChain } from "@/lib/rpc";
import { checkBearer } from "@/server/pools/auth";
import { runBackfillJob } from "@/server/pools/rpc/backfillJob";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const HEADERS = { "Cache-Control": "no-store" };

/**
 * Backfill of the Uniswap v4 RPC pipeline for one chain, behind `Authorization: Bearer ${CRON_SECRET}`. Each
 * call works for up to 150 seconds and answers `{ done, nextBlock, ... }`; repeat it until `done` is true, at
 * which point the chain's cursor is written and its cron job takes over. `?reset=1` first deletes the chain's
 * `rpc:` keys and its v3 payload and starts again from the earliest pool's creation block; send it on the first
 * call only, since every call with it starts over. The preview login does not apply: the middleware lets
 * `/api/admin/` through to this bearer check.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/admin/rpc-backfill/polygon
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
  const result = await runBackfillJob(chain, { reset });
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
