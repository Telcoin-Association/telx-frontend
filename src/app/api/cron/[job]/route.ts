import { checkBearer } from "@/server/pools/auth";
import { runCronWrite } from "@/server/pools/cronWrite";
import { CRON_JOBS, isCronJob } from "@/server/pools/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const HEADERS = { "Cache-Control": "no-store" };

/**
 * Vercel cron entry point for the pool data jobs listed in src/server/pools/jobs.ts (schedules in
 * vercel.json). Vercel sends GET with `Authorization: Bearer ${CRON_SECRET}`; the secret is required
 * everywhere, so a local run sets CRON_SECRET in .env.local and sends the same header.
 */
export async function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const auth = checkBearer(request.headers, "CRON_SECRET");
  if (!auth.ok) {
    const error = auth.status === 500 ? "Cron is not configured" : "Unauthorized";
    return Response.json({ error }, { status: auth.status, headers: HEADERS });
  }

  const { job } = await params;
  if (!isCronJob(job)) {
    return Response.json({ error: "Unknown cron job" }, { status: 404, headers: HEADERS });
  }

  const result = await runCronWrite(CRON_JOBS[job]);
  return Response.json(result.body, { status: result.status, headers: HEADERS });
}

function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { ...HEADERS, Allow: "GET" } });
}

// HEAD is declared so that it does not fall back to GET and run a job.
export const HEAD = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
