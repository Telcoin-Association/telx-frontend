import { apiPreviewRejection } from "@/helpers/previewAuth";
import type { RpcChain } from "@/lib/rpc";
import { parseQuoteQuery } from "@/server/swap/quoteQuery";

const HEADERS = { "Cache-Control": "no-store" };

/** The current and previous Settler on `chain`, from 0x's on-chain registry, through the server's Alchemy clients. */
async function registeredSettlers(chain: RpcChain): Promise<`0x${string}`[]> {
  const [{ publicClientEthereum, publicClientPolygon, publicClientBase }, { SETTLER_REGISTRY, SETTLER_REGISTRY_ABI, SETTLER_FEATURE }] = await Promise.all([
    import("../../backendHelpers/alchemy"),
    import("@/server/swap/zeroEx"),
  ]);
  const client = { ethereum: publicClientEthereum, polygon: publicClientPolygon, base: publicClientBase }[chain];
  const [current, previous] = await Promise.all([
    client.readContract({ address: SETTLER_REGISTRY, abi: SETTLER_REGISTRY_ABI, functionName: "ownerOf", args: [SETTLER_FEATURE] }),
    client.readContract({ address: SETTLER_REGISTRY, abi: SETTLER_REGISTRY_ABI, functionName: "prev", args: [SETTLER_FEATURE] }),
  ]);
  return [current, previous];
}

/**
 * A 0x swap quote for the Swap page: the indicative price without `taker`, the firm quote with it. Every answer is
 * per request and per wallet, so nothing is cached. See src/server/swap/zeroEx.ts for the checks on 0x's answer.
 */
export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;

  const parsed = parseQuoteQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: HEADERS });

  // Loaded on first use, so a request the preview login rejects, or an invalid one, loads neither viem nor zod.
  const { DEFAULT_SLIPPAGE_BPS, getSwapQuote } = await import("@/server/swap/zeroEx");
  const result = await getSwapQuote(
    {
      chain: parsed.chain,
      sellToken: parsed.sellToken,
      buyToken: parsed.buyToken,
      sellAmount: parsed.sellAmount,
      taker: parsed.taker,
      slippageBps: parsed.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    },
    { apiKey: process.env.ZEROX_API_KEY, fetch, settlers: registeredSettlers },
  );
  return Response.json(result.body, { status: result.status, headers: HEADERS });
}
