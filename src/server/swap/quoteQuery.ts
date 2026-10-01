import { isRpcChain, type RpcChain } from "@/lib/rpc";

/*
 * The query of GET /api/swap/quote, checked without viem or zod so that an invalid request costs nothing to reject.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^[1-9]\d{0,77}$/;

export type ParsedQuoteQuery =
  | {
      ok: true;
      chain: RpcChain;
      sellToken: `0x${string}`;
      buyToken: `0x${string}`;
      sellAmount: bigint;
      taker: `0x${string}` | null;
      slippageBps: number | null;
    }
  | { ok: false; error: string };

/** Checks the query: chain, both tokens (addresses, the native token included), a positive base-unit amount, and optionally the taker and slippage. */
export function parseQuoteQuery(params: URLSearchParams): ParsedQuoteQuery {
  const chain = params.get("chain") ?? "";
  if (!isRpcChain(chain)) return { ok: false, error: "chain must be ethereum, polygon or base" };
  const sellToken = params.get("sellToken") ?? "";
  const buyToken = params.get("buyToken") ?? "";
  if (!ADDRESS.test(sellToken) || !ADDRESS.test(buyToken)) return { ok: false, error: "sellToken and buyToken must be token addresses" };
  if (sellToken.toLowerCase() === buyToken.toLowerCase()) return { ok: false, error: "sellToken and buyToken must differ" };
  const sellAmount = params.get("sellAmount") ?? "";
  if (!AMOUNT.test(sellAmount)) return { ok: false, error: "sellAmount must be a positive whole number of base units" };
  const taker = params.get("taker");
  if (taker !== null && !ADDRESS.test(taker)) return { ok: false, error: "taker must be an address" };
  const slippage = params.get("slippageBps");
  let slippageBps: number | null = null;
  if (slippage !== null) {
    slippageBps = Number(slippage);
    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5_000) return { ok: false, error: "slippageBps must be a whole number from 1 to 5000" };
  }
  return {
    ok: true,
    chain,
    sellToken: sellToken as `0x${string}`,
    buyToken: buyToken as `0x${string}`,
    sellAmount: BigInt(sellAmount),
    taker: taker as `0x${string}` | null,
    slippageBps,
  };
}

