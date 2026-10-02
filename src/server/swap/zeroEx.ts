import "server-only";

import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { RpcChain } from "@/lib/rpc";

/**
 * Swap quotes from the 0x Swap API v2, AllowanceHolder flow (https://docs.0x.org/evm/0x-swap-api). The key stays on
 * the server; TELx takes no fee, so no swapFee parameters are sent.
 *
 * Every transaction 0x returns is checked against 0x's own contracts before it reaches a wallet. Swaps go through
 * AllowanceHolder, which has one address on every supported chain: it is the contract a token sell approves, and for a
 * native ETH or POL sell it forwards the value to Settler. A native sell may instead be addressed to Settler directly;
 * Settler's address changes with 0x's deployments, so it is read from 0x's on-chain Settler registry rather than
 * hardcoded, and only when a quote targets something other than AllowanceHolder.
 */

export const ZEROX_API = "https://api.0x.org";
export const ZEROX_VERSION = "v2";

/** 0x AllowanceHolder (Cancun deployment), the approval target and the target of every token sell. */
export const ALLOWANCE_HOLDER: Address = "0x0000000000001fF3684f28c67538d4D072C22734";

/** 0x's Settler registry: `ownerOf(2)` is the current taker-submitted Settler and `prev(2)` the one it replaced. */
export const SETTLER_REGISTRY: Address = "0x00000000000004533Fe15556B1E086BB1A72cEae";
export const SETTLER_FEATURE = 2n;
export const SETTLER_REGISTRY_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "prev", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint128" }], outputs: [{ type: "address" }] },
] as const;

/** How 0x names the chain's native token (ETH, or POL on Polygon). */
export const NATIVE_TOKEN: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const SWAP_CHAIN_IDS: Readonly<Record<RpcChain, number>> = { ethereum: 1, polygon: 137, base: 8453 };

export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 5_000;

export type QuoteRequest = {
  chain: RpcChain;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  /** Without a taker the indicative price endpoint answers, with no transaction. */
  taker: Address | null;
  slippageBps: number;
};

const digits = z.string().regex(/^\d+$/);
const address = z.string().refine((value) => isAddress(value, { strict: false }), "address");
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);

const QuoteSchema = z.union([
  z.object({ liquidityAvailable: z.literal(false) }),
  z.object({
    liquidityAvailable: z.literal(true),
    sellAmount: digits,
    buyAmount: digits,
    minBuyAmount: digits,
    gas: digits.nullish(),
    gasPrice: digits.nullish(),
    issues: z
      .object({
        allowance: z.object({ actual: digits, spender: address }).nullish(),
        balance: z.object({ token: address, actual: digits, expected: digits }).nullish(),
      })
      .nullish(),
    transaction: z.object({ to: address, data: hex, gas: digits.nullish(), gasPrice: digits.nullish(), value: digits }).nullish(),
    route: z.object({ fills: z.array(z.object({ source: z.string() })) }).nullish(),
    // 0x's own fee, which it charges on some pairs only. A fee block that doesn't parse reads as no fee shown, never a failed quote.
    fees: z
      .object({ zeroExFee: z.object({ amount: digits, token: address }).nullish() })
      .nullish()
      .catch(null),
  }),
]);

const ErrorSchema = z.object({ name: z.string().optional(), message: z.string().optional() });

/** What GET /api/swap/quote returns for a quote that has liquidity. Amounts are base-unit decimal strings. */
export type SwapQuote = {
  liquidityAvailable: true;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  /** Null when no approval is needed (a native sell, or the allowance already covers the amount). */
  allowance: { spender: Address; actual: string } | null;
  /** True when the taker holds less than the amount to sell. */
  balanceShort: boolean;
  gas: string | null;
  gasPrice: string | null;
  sources: string[];
  /** The fee 0x takes on this swap, in base units of `token`; null on a pair 0x doesn't charge. */
  zeroExFee: { amount: string; token: Address } | null;
  /** Absent for an indicative price (no taker). */
  transaction: { to: Address; data: Hex; value: string; gas: string | null } | null;
};

export type QuoteResult =
  | { status: 200; body: SwapQuote | { liquidityAvailable: false } }
  | { status: 400 | 429 | 502 | 503; body: { error: string } };

export type QuoteDeps = {
  apiKey: string | undefined;
  fetch: typeof fetch;
  /** The Settler addresses 0x's registry accepts right now on `chain`: current and previous. */
  settlers: (chain: RpcChain) => Promise<Address[]>;
};

export const NOT_CONFIGURED = "Swaps aren't available yet.";
const UNAVAILABLE = "Swaps are unavailable right now. Try again later.";
const UNVERIFIED = "The swap route could not be verified, so it was not offered.";

export function quoteUrl(request: QuoteRequest): string {
  const params = new URLSearchParams({
    chainId: String(SWAP_CHAIN_IDS[request.chain]),
    sellToken: request.sellToken,
    buyToken: request.buyToken,
    sellAmount: request.sellAmount.toString(),
    slippageBps: String(request.slippageBps),
  });
  if (request.taker) params.set("taker", request.taker);
  return `${ZEROX_API}/swap/allowance-holder/${request.taker ? "quote" : "price"}?${params}`;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Fetches and checks one quote. 0x's input errors become a 400 with 0x's message, a rejected key a 503 (logged),
 * rate limits a 429, and anything else a 502. A quote whose transaction is addressed to anything but AllowanceHolder,
 * or for a native sell a Settler the registry lists, is refused with a 502.
 */
export async function getSwapQuote(request: QuoteRequest, deps: QuoteDeps): Promise<QuoteResult> {
  if (!deps.apiKey) return { status: 503, body: { error: NOT_CONFIGURED } };

  let response: Response;
  try {
    response = await deps.fetch(quoteUrl(request), {
      headers: { "0x-api-key": deps.apiKey, "0x-version": ZEROX_VERSION },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(`0x quote request failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 502, body: { error: UNAVAILABLE } };
  }

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorSchema.safeParse(json);
    const message = parsed.success ? parsed.data.message : undefined;
    if (response.status === 400 || response.status === 422) {
      return { status: 400, body: { error: message ? `0x rejected the swap: ${message}` : "0x rejected the swap request." } };
    }
    if (response.status === 429) return { status: 429, body: { error: "Too many quotes. Try again in a moment." } };
    console.error(`0x quote failed with HTTP ${response.status}${parsed.success && parsed.data.name ? ` (${parsed.data.name})` : ""}`);
    return { status: response.status === 401 || response.status === 403 ? 503 : 502, body: { error: UNAVAILABLE } };
  }

  const parsed = QuoteSchema.safeParse(json);
  if (!parsed.success) {
    console.error("0x quote response did not match the expected shape");
    return { status: 502, body: { error: UNAVAILABLE } };
  }
  const quote = parsed.data;
  if (!quote.liquidityAvailable) return { status: 200, body: { liquidityAvailable: false } };

  const native = sameAddress(request.sellToken, NATIVE_TOKEN);
  if (quote.transaction) {
    const target = quote.transaction.to;
    if (sameAddress(target, ALLOWANCE_HOLDER)) {
      // AllowanceHolder is 0x's entry point for every sell.
    } else if (native) {
      let settlers: Address[];
      try {
        settlers = await deps.settlers(request.chain);
      } catch (error) {
        console.error(`0x Settler registry read failed on ${request.chain}: ${error instanceof Error ? error.message : String(error)}`);
        return { status: 502, body: { error: UNVERIFIED } };
      }
      if (!settlers.some((settler) => sameAddress(settler, target))) {
        console.error(`0x quote on ${request.chain} targeted ${target}, not a registered Settler`);
        return { status: 502, body: { error: UNVERIFIED } };
      }
    } else {
      console.error(`0x quote on ${request.chain} targeted ${target}, not AllowanceHolder`);
      return { status: 502, body: { error: UNVERIFIED } };
    }
  }

  const allowance = quote.issues?.allowance;
  if (allowance && !sameAddress(allowance.spender, ALLOWANCE_HOLDER)) {
    console.error(`0x quote on ${request.chain} asked to approve ${allowance.spender}, not AllowanceHolder`);
    return { status: 502, body: { error: UNVERIFIED } };
  }

  return {
    status: 200,
    body: {
      liquidityAvailable: true,
      sellAmount: quote.sellAmount,
      buyAmount: quote.buyAmount,
      minBuyAmount: quote.minBuyAmount,
      allowance: allowance ? { spender: getAddress(allowance.spender), actual: allowance.actual } : null,
      balanceShort: Boolean(quote.issues?.balance),
      gas: quote.transaction?.gas ?? quote.gas ?? null,
      gasPrice: quote.transaction?.gasPrice ?? quote.gasPrice ?? null,
      sources: [...new Set((quote.route?.fills ?? []).map((fill) => fill.source))],
      zeroExFee: quote.fees?.zeroExFee ? { amount: quote.fees.zeroExFee.amount, token: getAddress(quote.fees.zeroExFee.token) } : null,
      transaction: quote.transaction
        ? { to: getAddress(quote.transaction.to), data: quote.transaction.data as Hex, value: quote.transaction.value, gas: quote.transaction.gas ?? null }
        : null,
    },
  };
}
