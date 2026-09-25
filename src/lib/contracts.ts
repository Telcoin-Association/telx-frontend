// lib/contracts.ts

/// BASE
export const BASE_POSITION_MANAGER = "0x7c5f5a4bbd8fd63184577525326123b519429bdc";
export const BASE_HOOK_ADDRESS = "0x23aB2e6D4Ab0c5f872567098671F1ffb46Fd2500";
export const BASE_SUBSCRIBER = "0x735ee950D979C70C14FAa739f80fC96d9893f7ED";
export const BASE_ETH_TEL_POOLID = "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b";
export const BASE_POSITION_REGISTRY = "0x3994e3ae3Cf62bD2a3a83dcE73636E954852BB04";

/// POLYGON
export const POLYGON_POSITION_MANAGER = "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9";
export const POLYGON_HOOK_ADDRESS = "0xD77cC9230Ded5b6591730032975453744532a500";
export const POLYGON_SUBSCRIBER = "0x3Bf9bAdC67573e7b4756547A2dC0C77368A2062b";
export const POLYGON_WETH_TEL_POOLID = "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7";
export const POLYGON_USDC_EMXN_POOLID = "0x37dafec81119c7987538ac000b8a8a16a7f4daeecf91626efc9956ccd5146246";
export const POLYGON_POSITION_REGISTRY = "0x2c33fC9c09CfAC5431e754b8fe708B1dA3F5B954";

/// ETHEREUM
export const ETHEREUM_POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e" as `0x${string}`;
export const ETHEREUM_HOOK_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
export const ETHEREUM_SUBSCRIBER = "0xb9C089da356aa8E49c59BAE4BbCD61d586f942C5" as `0x${string}`;
// For testing purposes — Ethereum eUSD/TEL pool disabled for now
export const ETHEREUM_EUSD_TEL_POOLID = "0xd6771c30706f7933f3b1b1ac83f2f82c58673f556157e0414b1968702a5088d0";
export const ETHEREUM_POSITION_REGISTRY = "0xA74cB8EA667b186678DfC8ce33029fcA1E7733fE" as `0x${string}`;

/// Merkl Uniswap v4 pools — same registry/subscriber on Ethereum, Polygon, Base
export const MERKL_POSITION_REGISTRY = "0xcebC0b00473Ca00e429eF431826d0A32cdc945E1" as `0x${string}`;
export const MERKL_TELX_SUBSCRIBER = "0x19EDFa380ead0Bb26010Ca3d1C7AbC7213938c86" as `0x${string}`;

export const MERKL_ETH_TEL_POOLID = "0x272e0968e2fb347236c6060cc9395f13591968f3f83056c600c755066dd214a6";
export const MERKL_EUSD_TEL_POOLID = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
export const MERKL_POLYGON_WETH_TEL_POOLID = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
export const MERKL_POLYGON_EUSD_EMXN_POOLID = "0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135";

export const MERKL_UNISWAP_POOL_IDS = new Set([
  MERKL_ETH_TEL_POOLID,
  MERKL_EUSD_TEL_POOLID,
  MERKL_POLYGON_WETH_TEL_POOLID,
  MERKL_POLYGON_EUSD_EMXN_POOLID,
].map((id) => id.toLowerCase()));

export function isMerklUniswapPool(poolId?: string) {
  return Boolean(poolId && MERKL_UNISWAP_POOL_IDS.has(poolId.trim().toLowerCase()));
}

export function getPoolMapKey(poolAddress: string, blockchain?: string | null, protocol?: string | null) {
  if (protocol === "uniswap" && blockchain) {
    return `${blockchain}:${poolAddress.trim().toLowerCase()}`;
  }
  return poolAddress;
}

export function getPoolPath(poolAddress: string, blockchain?: string | null, protocol?: string | null) {
  if (protocol === "uniswap" && blockchain) {
    return `/pool/${poolAddress}?chain=${blockchain}`;
  }
  return `/pool/${poolAddress}`;
}

/// Display order for pool lists: Polygon first, then Base, then Ethereum.
const NETWORK_DISPLAY_ORDER = ["polygon", "base", "ethereum"];

type PoolWithNetwork = { attributes?: { blockchain?: string | null; network?: string | null } | null };

/** Sorts pool.json entries by network for display. Order within a network is preserved; unknown networks go last. */
export function sortPoolsByNetwork<T extends PoolWithNetwork>(pools: T[]): T[] {
  const rank = (pool: T) => {
    const network = (pool?.attributes?.blockchain || pool?.attributes?.network || "").toLowerCase();
    const index = NETWORK_DISPLAY_ORDER.indexOf(network);
    return index === -1 ? NETWORK_DISPLAY_ORDER.length : index;
  };
  return [...pools].sort((a, b) => rank(a) - rank(b));
}

export function getUniswapChainAddresses(blockchain?: string, poolId?: string) {
  const merklPool = isMerklUniswapPool(poolId);

  if (blockchain === "ethereum") {
    return {
      positionManager: ETHEREUM_POSITION_MANAGER,
      subscriber: merklPool ? MERKL_TELX_SUBSCRIBER : ETHEREUM_SUBSCRIBER,
      positionRegistry: merklPool ? MERKL_POSITION_REGISTRY : ETHEREUM_POSITION_REGISTRY,
      positionsApiPath: "/api/uniswap-user-positions-ethereum",
      explorerTxBase: "https://etherscan.io/tx/",
      explorerName: "Etherscan",
    };
  }
  if (blockchain === "base") {
    return {
      positionManager: BASE_POSITION_MANAGER,
      subscriber: merklPool ? MERKL_TELX_SUBSCRIBER : BASE_SUBSCRIBER,
      positionRegistry: merklPool ? MERKL_POSITION_REGISTRY : BASE_POSITION_REGISTRY,
      positionsApiPath: "/api/uniswap-user-positions-base",
      explorerTxBase: "https://basescan.org/tx/",
      explorerName: "Basescan",
    };
  }
  return {
    positionManager: POLYGON_POSITION_MANAGER,
    subscriber: merklPool ? MERKL_TELX_SUBSCRIBER : POLYGON_SUBSCRIBER,
    positionRegistry: merklPool ? MERKL_POSITION_REGISTRY : POLYGON_POSITION_REGISTRY,
    positionsApiPath: "/api/uniswap-user-positions-polygon",
    explorerTxBase: "https://polygonscan.com/tx/",
    explorerName: "Polygonscan",
  };
}
