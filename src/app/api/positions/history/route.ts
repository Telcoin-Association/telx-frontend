import type { NextRequest } from "next/server";
import { BaseError } from "viem";
import { apiPreviewRejection } from "@/helpers/previewAuth";
import { SHARED_CACHE_CONTROL, sharedCacheControl } from "@/lib/cacheControl";
import { isRpcChain } from "@/lib/rpc";
import { TimeoutError } from "@/server/chain/logs";
import { getRedis } from "@/server/pools/redis";
import type { RpcRedis } from "@/server/pools/rpc/store";
import { positionHistory, type HistoryClient } from "@/server/positions/history";
import { positionsChain } from "@/server/positions/chains";
import { readDispute } from "@/server/positions/dispute";
import { poolRewardsIndex } from "@/server/positions/poolRewards";
import { positionRewardsFromIndex } from "@/server/positions/rewards";
import { isMerklUniswapPool } from "@/lib/contracts";
import { describeError } from "../../backendHelpers/errors";

export const dynamic = "force-dynamic";
/** The position's logs since the pool's creation, a few dozen archive price reads at most, and the pool's rewards index. */
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/positions/history?chain=polygon|base|ethereum&tokenId=N
 *
 * The history of one Uniswap v4 position in a registry pool (see PositionHistory in
 * src/server/positions/history.ts). It is the same for every visitor, so the CDN may serve it. Inputs are
 * checked before any upstream call. A token outside the registry pools, or one that doesn't exist, is a 404.
 */
export async function GET(request: NextRequest) {
  const previewRejected = await apiPreviewRejection(request);
  if (previewRejected) return previewRejected;

  const params = request.nextUrl.searchParams;
  const chain = params.get("chain");
  const tokenId = params.get("tokenId");
  if (!chain || !isRpcChain(chain)) {
    return Response.json({ error: "Unknown chain" }, { status: 400, headers: NO_STORE });
  }
  if (!tokenId || !/^\d{1,30}$/.test(tokenId)) {
    return Response.json({ error: "Invalid tokenId" }, { status: 400, headers: NO_STORE });
  }

  try {
    const { client, positionManager } = positionsChain(chain);
    const history = await positionHistory(chain, BigInt(tokenId), {
      client: client as unknown as HistoryClient,
      redis: getRedis() as unknown as RpcRedis,
      positionManager,
      // TEL's price on Polygon, for deposits and withdrawals this chain's own TEL routes were too thin to price.
      polygon: chain === "polygon" ? undefined : positionsChain("polygon").client,
      // TELx rewards come from the pool's rewards index, keyed by token id; pools outside the program have none.
      rewards: poolId => (isMerklUniswapPool(poolId) ? poolRewardsIndex(chain, poolId, { readDispute }).then(index => positionRewardsFromIndex(index, tokenId)) : Promise.resolve(null)),
    });
    if (!history) return Response.json({ error: "Position not found in a TELx pool" }, { status: 404, headers: NO_STORE });
    return Response.json(history, { headers: { "Cache-Control": sharedCacheControl(SHARED_CACHE_CONTROL) } });
  } catch (error) {
    const upstream = error instanceof BaseError || error instanceof TimeoutError;
    console.error(`Position history for ${tokenId} on ${chain} failed:`, describeError(error));
    return upstream
      ? Response.json({ error: "Position history lookup failed" }, { status: 502, headers: NO_STORE })
      : Response.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
