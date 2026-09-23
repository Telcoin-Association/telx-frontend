/**
 * Merkl integration constants.
 * Isolated from existing claim system — safe to remove this folder when Merkl is verified.
 */

export const MERKL_API_BASE_URL = "https://api.merkl.xyz/v4";

/** Ethereum Mainnet */
export const MERKL_ETHEREUM_CHAIN_ID = 1;

/** Base Mainnet */
export const MERKL_BASE_CHAIN_ID = 8453;

/** Polygon Mainnet */
export const MERKL_POLYGON_CHAIN_ID = 137;

/** Chains where TELx Merkl rewards are surfaced */
export const MERKL_SUPPORTED_CHAIN_IDS = [
  MERKL_ETHEREUM_CHAIN_ID,
  MERKL_BASE_CHAIN_ID,
  MERKL_POLYGON_CHAIN_ID,
] as const;

/** @deprecated Use MERKL_BASE_CHAIN_ID — kept for backwards compatibility */
export const MERKL_CHAIN_ID = MERKL_BASE_CHAIN_ID;

/**
 * Merkl Distributor contract — same address on Ethereum, Base, and Polygon per Merkl docs.
 * @see https://developers.merkl.xyz/resources/chains-and-contracts
 */
export const MERKL_DISTRIBUTOR_ADDRESS =
  "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae" as const;

/** TEL/ETH Uniswap V4 pool ID on Base */
export const TEL_ETH_POOL_ID =
  "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b";

/** TELx PositionRegistry on Base (existing system — referenced for context only) */
export const POSITION_REGISTRY_ADDRESS =
  "0x3994e3ae3Cf62bD2a3a83dcE73636E954852BB04";

/** TEL token addresses per chain */
export const TEL_TOKEN_ADDRESSES: Record<number, string> = {
  [MERKL_ETHEREUM_CHAIN_ID]: "0x85e076361cc813a908ff672f9bad1541474402b2",
  [MERKL_BASE_CHAIN_ID]: "0x09bE1692ca16e06f536F0038fF11D1dA8524aDB1",
  [MERKL_POLYGON_CHAIN_ID]: "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32",
};

/** Display metadata for TEL on each Merkl-supported chain (fallback when API has no rewards) */
export const TEL_TOKEN_INFO: Record<
  number,
  { name: string; symbol: string; decimals: number; icon: string }
> = {
  [MERKL_ETHEREUM_CHAIN_ID]: {
    name: "Telcoin",
    symbol: "TEL",
    decimals: 2,
    icon: "https://assets.coingecko.com/coins/images/1899/standard/tel.png?1696502892",
  },
  [MERKL_BASE_CHAIN_ID]: {
    name: "Telcoin",
    symbol: "TEL",
    decimals: 2,
    icon: "https://assets.coingecko.com/coins/images/1899/standard/tel.png?1696502892",
  },
  [MERKL_POLYGON_CHAIN_ID]: {
    name: "Telcoin (PoS)",
    symbol: "TEL",
    decimals: 2,
    icon: "https://storage.googleapis.com/merkl-static-assets/tokens/TEL.svg",
  },
};

/** Minimum ABI for Merkl Distributor claim function */
export const MERKL_DISTRIBUTOR_ABI = [
  {
    inputs: [
      { name: "users", type: "address[]" },
      { name: "tokens", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "proofs", type: "bytes32[][]" },
    ],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export type MerklBlockchain = "ethereum" | "base" | "polygon";

export const MERKL_CHAIN_CONFIG: Record<
  MerklBlockchain,
  { chainId: number; label: string }
> = {
  ethereum: { chainId: MERKL_ETHEREUM_CHAIN_ID, label: "Ethereum · eUSD/TEL" },
  base: { chainId: MERKL_BASE_CHAIN_ID, label: "Base · TEL/ETH" },
  polygon: { chainId: MERKL_POLYGON_CHAIN_ID, label: "Polygon · TEL/WETH" },
};
