import { isMerklUniswapPool } from "./contracts";

/** Legacy TEL (TEL2, 2 decimals), replaced by TEL3 */
export const LEGACY_TEL_ADDRESSES = [
  "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32", // Polygon
  "0x467Bccd9d29f223BcE8043b84E8C8B282827790F", // Ethereum
  "0x09bE1692ca16e06f536F0038fF11D1dA8524aDB1", // Base
];

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
