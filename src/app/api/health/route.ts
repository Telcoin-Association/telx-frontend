import { checkBearer } from "@/server/pools/auth";
import { buildHealth } from "@/server/pools/health";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

/**
 * Freshness and last cron outcome of every pool data key, for an external monitor. Requires
 * `Authorization: Bearer ${HEALTH_CHECK_SECRET}`. 200 when every gating key is fresh and not lagging,
 * 503 otherwise.
 */
export async function GET(request: Request) {
  const auth = checkBearer(request.headers, "HEALTH_CHECK_SECRET");
  if (!auth.ok) {
    const error = auth.status === 500 ? "Health check is not configured" : "Unauthorized";
    return Response.json({ error }, { status: auth.status, headers: HEADERS });
  }

  try {
    const health = await buildHealth(Date.now());
    return Response.json(health, { status: health.ok ? 200 : 503, headers: HEADERS });
  } catch (err) {
    console.error("Health check could not read the cache", err);
    return Response.json({ error: "Health check failed" }, { status: 500, headers: HEADERS });
  }
}
