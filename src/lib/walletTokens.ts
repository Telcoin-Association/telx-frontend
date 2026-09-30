import { TEL_DECIMALS, TEL_TOKEN_ADDRESS } from "@/merkl/merklConstants";

/** A token the "Add to wallet" button can ask the wallet to track (EIP-747 `wallet_watchAsset`). */
export type WatchableToken = Readonly<{
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** Logo under `public/`, as a PNG: injected wallets render the image as a bitmap and ignore an SVG. */
  imagePath: string;
}>;

/**
 * TEL3 and eUSD, the tokens TELx pays out and swaps into. Each has one address on Ethereum, Polygon and Base, so
 * adding it on the wallet's current chain is right whichever of the three that is. Legacy TEL is never offered:
 * nothing on TELx pays in it any more.
 */
export const WATCHABLE_TOKENS = {
  TEL: { address: TEL_TOKEN_ADDRESS, symbol: "TEL", decimals: TEL_DECIMALS, imagePath: "/coins/tel.png" },
  eUSD: { address: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949", symbol: "eUSD", decimals: 6, imagePath: "/coins/eUSD.png" },
} as const satisfies Record<string, WatchableToken>;

/** The watchable token at `address` (any letter case), or null for every other token. */
export function watchableTokenAt(address: string | null | undefined): WatchableToken | null {
  if (!address) return null;
  const wanted = address.toLowerCase();
  return Object.values(WATCHABLE_TOKENS).find(token => token.address.toLowerCase() === wanted) ?? null;
}
