import { isAddress } from "viem";
import { apiPreviewRejection } from "@/helpers/previewAuth";
import { SHARED_CACHE_CONTROL, sharedCacheControl } from "@/lib/cacheControl";
import { isRpcChain } from "@/lib/rpc";
import { fetchWalletPositionRewards } from "@/server/positions/rewards";
import { describeError } from "../../backendHelpers/errors";

export const dynamic = "force-dynamic";
/** One Merkl read. */
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/positions/rewards?chain=polygon|base|ethereum&owner=0x…
 *
 * Every position's TELx rewards in one wallet on one chain (see WalletPositionRewards), from a single Merkl read,
 * so a positions list asks once per wallet rather than once per position. Merkl's rewards are public and the
 * same for every visitor, so the CDN may serve them for a short while.
 */
export async function GET(request: Request) {
  const previewRejected = await apiPreviewRejection(request);
  if (previewRejected) return previewRejected;

  const params = new URL(request.url).searchParams;
  const chain = params.get("chain");
  const owner = params.get("owner");
  if (!chain || !isRpcChain(chain)) {
    return Response.json({ error: "Unknown chain" }, { status: 400, headers: NO_STORE });
  }
  if (!owner || !isAddress(owner, { strict: false })) {
    return Response.json({ error: "Invalid owner" }, { status: 400, headers: NO_STORE });
  }

  try {
    const rewards = await fetchWalletPositionRewards(chain, owner);
    if (!rewards) return Response.json({ error: "Merkl rewards unavailable" }, { status: 502, headers: NO_STORE });
    return Response.json(rewards, { headers: { "Cache-Control": sharedCacheControl(SHARED_CACHE_CONTROL) } });
  } catch (error) {
    console.error("Position rewards for %s on %s failed:", owner, chain, describeError(error));
    return Response.json({ error: "Merkl rewards unavailable" }, { status: 502, headers: NO_STORE });
  }
}
