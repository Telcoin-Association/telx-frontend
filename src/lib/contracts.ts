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
export const ETHEREUM_EUSD_TEL_POOLID = "0xd6771c30706f7933f3b1b1ac83f2f82c58673f556157e0414b1968702a5088d0";
export const ETHEREUM_POSITION_REGISTRY = "0xA74cB8EA667b186678DfC8ce33029fcA1E7733fE" as `0x${string}`;

export function getUniswapChainAddresses(blockchain?: string) {
  if (blockchain === "ethereum") {
    return {
      positionManager: ETHEREUM_POSITION_MANAGER,
      subscriber: ETHEREUM_SUBSCRIBER,
      positionRegistry: ETHEREUM_POSITION_REGISTRY,
      positionsApiPath: "/api/uniswap-user-positions-ethereum",
      explorerTxBase: "https://etherscan.io/tx/",
      explorerName: "Etherscan",
    };
  }
  if (blockchain === "base") {
    return {
      positionManager: BASE_POSITION_MANAGER,
      subscriber: BASE_SUBSCRIBER,
      positionRegistry: BASE_POSITION_REGISTRY,
      positionsApiPath: "/api/uniswap-user-positions-base",
      explorerTxBase: "https://basescan.org/tx/",
      explorerName: "Basescan",
    };
  }
  return {
    positionManager: POLYGON_POSITION_MANAGER,
    subscriber: POLYGON_SUBSCRIBER,
    positionRegistry: POLYGON_POSITION_REGISTRY,
    positionsApiPath: "/api/uniswap-user-positions-polygon",
    explorerTxBase: "https://polygonscan.com/tx/",
    explorerName: "Polygonscan",
  };
}



const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_ID;
export const ETHEREUM_RPC_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
export const BASE_RPC_URL = `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
export const POLYGON_RPC_URL = `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

