import { isMerklUniswapPool } from "./contracts";

/** Legacy TEL (TEL2, 2 decimals), replaced by TEL3 */
export const LEGACY_TEL_ADDRESSES = [
  "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32", // Polygon
  "0x467Bccd9d29f223BcE8043b84E8C8B282827790F", // Ethereum
  "0x09bE1692ca16e06f536F0038fF11D1dA8524aDB1", // Base
];

/** Legacy TEL by chain. Every deployment uses 2 decimals (read on chain). */
export const LEGACY_TEL_BY_CHAIN = {
  polygon: "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32",
  ethereum: "0x467Bccd9d29f223BcE8043b84E8C8B282827790F",
  base: "0x09bE1692ca16e06f536F0038fF11D1dA8524aDB1",
} as const satisfies Record<string, `0x${string}`>;
export const LEGACY_TEL_DECIMALS = 2;

/**
 * The official TEL upgrade site, run by the token-migration-frontend repository: it upgrades legacy TEL to TEL3
 * through the TelcoinMigration vault and bridges TEL3 between Ethereum, Polygon and Base. TELx links to it rather
 * than calling those contracts itself, since the site tells users it is the only upgrade site.
 */
export const TEL_UPGRADE_SITE = "https://tel3.telcoin.network";
export const TEL_UPGRADE_URL = `${TEL_UPGRADE_SITE}/upgrade`;
export const TEL_BRIDGE_URL = `${TEL_UPGRADE_SITE}/bridge`;
/** The site's host as shown next to the links, so the destination is visible before clicking. */
export const TEL_UPGRADE_HOST = new URL(TEL_UPGRADE_SITE).host;

const LEGACY_TEL_SET = new Set(LEGACY_TEL_ADDRESSES.map((address) => address.toLowerCase()));

export function isLegacyTel(address?: string | null) {
  return Boolean(address && LEGACY_TEL_SET.has(address.toLowerCase()));
}

// Merkl pools pay rewards in TEL3; every other pool paid legacy TEL
export function paysLegacyTelRewards(poolAddress?: string | null) {
  return !isMerklUniswapPool(poolAddress ?? undefined);
}

const TOKEN_EXPLORER_BY_NETWORK: Record<string, string> = {
  ethereum: "https://etherscan.io/token/",
  polygon: "https://polygonscan.com/token/",
  base: "https://basescan.org/token/",
};

export function getTokenExplorerUrl(blockchain?: string | null, address?: string | null) {
  const base = blockchain ? TOKEN_EXPLORER_BY_NETWORK[blockchain.toLowerCase()] : undefined;
  return base && address ? `${base}${address}` : undefined;
}

/** Key into the coin image maps; legacy TEL uses the greyed-out logo */
export function getTokenIconKey(ticker: string, legacy = false) {
  const key = ticker.toLowerCase();
  return key === "tel" && legacy ? "tel_legacy" : key;
}
