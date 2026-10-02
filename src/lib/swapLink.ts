import { zeroAddress } from "viem";
import { isRpcChain } from "./rpc";
import { NATIVE_TOKEN } from "@/web3/swap/tokens";

/**
 * A link to the swap page set up to buy `buy` on `chain`, optionally selling `sell`. Uniswap v4 pools name native
 * ETH by the zero address while the swap page (like the 0x API) uses 0xEeee...EeE, so the zero address is
 * translated. A chain the swap page does not serve is left out, and the page falls back to its default chain.
 */
export function swapHref({ chain, buy, sell }: { chain: string | undefined; buy: string; sell?: string }): string {
  const params = new URLSearchParams();
  if (chain && isRpcChain(chain)) params.set("chain", chain);
  if (sell) params.set("sell", swapTokenAddress(sell));
  params.set("buy", swapTokenAddress(buy));
  return `/swap?${params.toString()}`;
}

const swapTokenAddress = (address: string) => (address.toLowerCase() === zeroAddress ? NATIVE_TOKEN : address);
