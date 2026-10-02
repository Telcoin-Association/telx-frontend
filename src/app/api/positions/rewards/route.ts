import { apiPreviewRejection } from "@/helpers/previewAuth";
import { sharedCacheControl } from "@/lib/cacheControl";
import { isMerklUniswapPool } from "@/lib/contracts";
import { isRpcChain } from "@/lib/rpc";
import { readDispute } from "@/server/positions/dispute";
import { poolRewardsIndex } from "@/server/positions/poolRewards";
import { describeError } from "../../backendHelpers/errors";

export const dynamic = "force-dynamic";
/** Every reward row of the pool's campaigns, a page of 1,000 rows at a time. */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/** The CDN serves an index for three minutes, matching how long the server keeps it, then revalidates. */
const INDEX_CACHE_CONTROL = "public, s-maxage=180, stale-while-revalidate=600";

/**
 * GET /api/positions/rewards?chain=polygon|base|ethereum&poolId=0x…
 *
 * Every position's TELx rewards in one TELx pool (see PoolRewardsIndex), built from Merkl's per-campaign reward rows
 * and the same for every visitor, so one index serves every position and every wallet. Only TELx reward pools are
 * accepted.
 */
export async function GET(request: Request) {
  const previewRejected = await apiPreviewRejection(request);
  if (previewRejected) return previewRejected;

  const params = new URL(request.url).searchParams;
  const chain = params.get("chain");
  const poolId = params.get("poolId")?.trim().toLowerCase() ?? "";
  if (!chain || !isRpcChain(chain)) {
    return Response.json({ error: "Unknown chain" }, { status: 400, headers: NO_STORE });
  }
  if (!/^0x[0-9a-f]{64}$/.test(poolId) || !isMerklUniswapPool(poolId)) {
    return Response.json({ error: "Not a TELx reward pool" }, { status: 404, headers: NO_STORE });
  }

  try {
    const index = await poolRewardsIndex(chain, poolId, { readDispute });
    return Response.json(index, { headers: { "Cache-Control": sharedCacheControl(INDEX_CACHE_CONTROL) } });
  } catch (error) {
    console.error("Pool rewards for %s on %s failed:", poolId, chain, describeError(error));
    return Response.json({ error: "Merkl rewards unavailable" }, { status: 502, headers: NO_STORE });
  }
}
