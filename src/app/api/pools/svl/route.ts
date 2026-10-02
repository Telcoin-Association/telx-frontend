import { apiPreviewRejection } from "@/helpers/previewAuth";
import { SHARED_CACHE_CONTROL, sharedCacheControl } from "@/lib/cacheControl";
import type { SvlResponse } from "@/lib/svl";
import { readPoolSvl } from "@/server/pools/merkl/svlDays";
import { poolIdsFor, type Chain } from "@/server/pools/registry";

export const dynamic = "force-dynamic";

const CHAINS: readonly Chain[] = ["polygon", "base", "ethereum"];

/**
 * One pool's subscribed liquidity by day, for the pool page's SVL chart: `?chain=<chain>&poolId=<id>`. Only
 * pools in the registry are read. The body is the same for every visitor, so it is cached at the edge; a failed
 * read is 502 and not cached.
 */
export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;

  const { searchParams } = new URL(request.url);
  const chain = searchParams.get("chain") as Chain | null;
  const poolId = searchParams.get("poolId")?.trim().toLowerCase() ?? "";
  if (!chain || !CHAINS.includes(chain) || !poolIdsFor("uniswap", chain).some(id => id.toLowerCase() === poolId)) {
    return Response.json({ error: "Unknown pool." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const body: SvlResponse = { days: await readPoolSvl(chain, poolId) };
    return Response.json(body, { headers: { "Cache-Control": sharedCacheControl(SHARED_CACHE_CONTROL) } });
  } catch (err) {
    console.error("SVL read failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "SVL history is unavailable right now." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
