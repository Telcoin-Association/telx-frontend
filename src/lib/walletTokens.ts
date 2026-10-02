import { TEL_DECIMALS, TEL_TOKEN_ADDRESS } from "@/merkl/merklConstants";

/** A token the "Add to wallet" button can ask the wallet to track (EIP-747 `wallet_watchAsset`). */
export type WatchableToken = Readonly<{
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** Logo under `public/`, as a PNG: injected wallets render the image as a bitmap and ignore an SVG. */
  imagePath: string;
  /** The one chain the token exists on at this address. Absent for a token with this address on every supported chain. */
  chainId?: WalletChainId;
}>;

/** Supported chains by registry name, and their display names. */
export type WalletChainId = 1 | 137 | 8453;
export const WALLET_CHAIN_IDS: Readonly<Record<string, WalletChainId>> = { ethereum: 1, polygon: 137, base: 8453 };
export const WALLET_CHAIN_NAMES: Readonly<Record<WalletChainId, string>> = { 1: "Ethereum", 137: "Polygon", 8453: "Base" };

/**
 * The tokens of TELx's active pools. TEL3 and eUSD have one address on Ethereum, Polygon and Base, so adding them on
 * the wallet's current chain is right whichever of the three that is. WETH and eMXN are Polygon tokens: their
 * addresses hold nothing elsewhere, so they carry their chain and are only offered for it. Legacy TEL is never
 * offered: nothing on TELx pays in it any more. Native ETH has no contract to add.
 */
export const WATCHABLE_TOKENS = {
  TEL: { address: TEL_TOKEN_ADDRESS, symbol: "TEL", decimals: TEL_DECIMALS, imagePath: "/coins/tel.png" },
  eUSD: { address: "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949", symbol: "eUSD", decimals: 6, imagePath: "/coins/eUSD.png" },
  WETH_POLYGON: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", decimals: 18, imagePath: "/coins/weth.png", chainId: 137 },
  EMXN_POLYGON: { address: "0x68727e573D21a49c767c3c86A92D9F24bd933c99", symbol: "eMXN", decimals: 6, imagePath: "/coins/emxn.png", chainId: 137 },
} as const satisfies Record<string, WatchableToken>;

/**
 * The watchable token at `address` (any letter case) on `chain` (a registry chain name), or null for every other
 * token. A chain-bound token matches only on its own chain; without a chain, only tokens valid on every chain match.
 */
export function watchableTokenAt(address: string | null | undefined, chain?: string | null): WatchableToken | null {
  if (!address) return null;
  const wanted = address.toLowerCase();
  const chainId = chain ? WALLET_CHAIN_IDS[chain.toLowerCase()] : undefined;
  return (
    Object.values(WATCHABLE_TOKENS).find(
      (token: WatchableToken) => token.address.toLowerCase() === wanted && (token.chainId === undefined || token.chainId === chainId),
    ) ?? null
  );
}
