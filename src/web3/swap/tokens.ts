import type { Address } from "viem";
import type { RpcChain } from "@/lib/rpc";

/** How the 0x Swap API names a chain's native token (ETH, or POL on Polygon). */
export const NATIVE_TOKEN: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export type SwapToken = Readonly<{ address: Address; symbol: string; decimals: number; icon?: string }>;

const TEL3: SwapToken = { address: "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731", symbol: "TEL", decimals: 18, icon: "/coins/tel.png" };
const EUSD: SwapToken = { address: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949", symbol: "eUSD", decimals: 6, icon: "/coins/eUSD.png" };

/**
 * The tokens each chain's pickers list, TELx's own first. USDC is the chain's native USDC (the eUSD vault's `GEM()`);
 * Polygon's bridged USDC.e is listed separately so LPs from the old pools can convert it. Any other token is entered
 * by address.
 */
export const SWAP_TOKENS: Readonly<Record<RpcChain, readonly SwapToken[]>> = {
  polygon: [
    TEL3,
    EUSD,
    { address: "0x68727e573D21a49c767c3c86A92D9F24bd933c99", symbol: "eMXN", decimals: 6, icon: "/coins/emxn.png" },
    { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", decimals: 6, icon: "/coins/usdc.png" },
    { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", decimals: 18, icon: "/coins/weth.png" },
    { address: NATIVE_TOKEN, symbol: "POL", decimals: 18, icon: "/coins/matic.png" },
    { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", symbol: "USDC.e", decimals: 6, icon: "/coins/usdc.png" },
  ],
  base: [
    TEL3,
    EUSD,
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, icon: "/coins/usdc.png" },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18, icon: "/coins/weth.png" },
    { address: NATIVE_TOKEN, symbol: "ETH", decimals: 18, icon: "/coins/eth.png" },
  ],
  ethereum: [
    TEL3,
    EUSD,
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, icon: "/coins/usdc.png" },
    { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18, icon: "/coins/weth.png" },
    { address: NATIVE_TOKEN, symbol: "ETH", decimals: 18, icon: "/coins/eth.png" },
  ],
};

export const SWAP_CHAIN_IDS: Readonly<Record<RpcChain, 1 | 137 | 8453>> = { ethereum: 1, polygon: 137, base: 8453 };
export const SWAP_CHAIN_BY_ID: Readonly<Record<number, RpcChain>> = { 1: "ethereum", 137: "polygon", 8453: "base" };

export const isNative = (address: string) => address.toLowerCase() === NATIVE_TOKEN.toLowerCase();

/** The listed token at `address` on `chain` (any letter case), or undefined. */
export function listedToken(chain: RpcChain, address: string | null | undefined): SwapToken | undefined {
  if (!address) return undefined;
  const wanted = address.toLowerCase();
  return SWAP_TOKENS[chain].find((token) => token.address.toLowerCase() === wanted);
}

/** The chain's native USDC and eUSD, the two sides of the eUSD vault. */
export const vaultPair = (chain: RpcChain) => ({
  eusd: EUSD.address,
  usdc: SWAP_TOKENS[chain].find((token) => token.symbol === "USDC")!.address,
});
