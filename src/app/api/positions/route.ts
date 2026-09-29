import type { NextRequest } from "next/server";
import { BaseError, getAddress, isAddress } from "viem";
import { isRpcChain } from "@/lib/rpc";
import { TimeoutError } from "@/server/chain/logs";
import { getChainPositions } from "@/server/positions/service";
import { describeError } from "../backendHelpers/errors";
import { AlchemyNftError } from "../backendHelpers/positionTokens";

export const dynamic = "force-dynamic";
/** The token listing has a 15 second budget (TOKEN_LIST_BUDGET_MS) and the reads after it take a few more. */
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

/** Largest `minBlock` accepted; far above any head on the supported chains. */
const MAX_BLOCK = 10_000_000_000;

/**
 * GET /api/positions?chain=polygon|base|ethereum&owner=0x...[&minBlock=N]
 *
 * The owner's Uniswap v4 positions in every registry pool on the chain, keyed by lowercase pool id (see
 * ChainPositions in src/lib/positions.ts). `minBlock` asks for data read at that block or later, so it
 * skips the short per-owner cache when that cache is older. Inputs are checked before any upstream call.
 * The body is per owner, so it is never cached at the edge.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const chain = params.get("chain");
  const owner = params.get("owner");
  const minBlockParam = params.get("minBlock");

  if (!chain || !isRpcChain(chain)) {
    return Response.json({ error: "Unknown chain" }, { status: 400, headers: NO_STORE });
  }
  if (!owner || !isAddress(owner, { strict: false })) {
    return Response.json({ error: "Invalid owner" }, { status: 400, headers: NO_STORE });
  }
  let minBlock: number | undefined;
  if (minBlockParam !== null) {
    minBlock = /^\d{1,11}$/.test(minBlockParam) ? Number(minBlockParam) : NaN;
    if (!Number.isSafeInteger(minBlock) || minBlock > MAX_BLOCK) {
      return Response.json({ error: "Invalid minBlock" }, { status: 400, headers: NO_STORE });
    }
  }

  try {
    const positions = await getChainPositions(chain, getAddress(owner), minBlock);
    return Response.json(positions, { headers: NO_STORE });
  } catch (error) {
    const upstream = error instanceof AlchemyNftError || error instanceof BaseError || error instanceof TimeoutError;
    console.error(`Positions request on ${chain} failed:`, describeError(error));
    return upstream
      ? Response.json({ error: "Position lookup failed" }, { status: 502, headers: NO_STORE })
      : Response.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
