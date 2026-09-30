import type { Address } from "viem";

/**
 * Pinned eUSD Peg Stability Vault deployments.
 *
 * These addresses are the trust anchor for the vault page. They live in source so that changing one requires a
 * reviewed commit, and `deployments.test.ts` repeats every literal so an edit here fails a test until the test is
 * updated on purpose. At run time the page also checks them against the vault's own `STABLE()` and `GEM()` and
 * fails closed on a mismatch.
 *
 * Verified on chain 2026-09-30: the vault is one UUPS proxy address on all three chains (implementation
 * `0x8bE82303829042F0Fba1315096A8F1961907C0Dd`, matching `src/psv/PegStabilityVault.sol` in the separate
 * `tdab-stablecoin` contracts repository),
 * `STABLE()` returned the eUSD address and `GEM()` the chain's native USDC. Both tokens have 6 decimals.
 */

export type VaultChainId = 1 | 137 | 8453;

/** `usdcToEusd` calls `sellGem`, `eusdToUsdc` calls `buyGem`. */
export type SwapDirection = "usdcToEusd" | "eusdToUsdc";

export type VaultOperation = "approve" | "swap";

export type VaultDeployment = Readonly<{
  chainId: VaultChainId;
  /** Receipt confirmations to wait for before a transaction counts as final. */
  confirmations: number;
  vault: Address;
  /** eUSD, the vault's `STABLE()`. */
  stable: Address;
  /** USDC, the vault's `GEM()`. */
  gem: Address;
  multicall3: Address;
  decimals: 6;
  chainKey: "ethereum" | "polygon" | "base";
  explorerUrl: string;
}>;

/** Display order. */
export const VAULT_CHAIN_IDS: readonly VaultChainId[] = Object.freeze([1, 137, 8453] as const);

/** eUSD and USDC both use 6 decimals on every supported chain. */
export const VAULT_DECIMALS = 6;

const VAULT: Address = "0xc72178D412256a6Dc5f04D749859b4cd95076d61";
const EUSD: Address = "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949";
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const VAULT_DEPLOYMENTS: Readonly<Record<VaultChainId, VaultDeployment>> = Object.freeze({
  1: Object.freeze({
    chainId: 1,
    confirmations: 1,
    vault: VAULT,
    stable: EUSD,
    gem: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    multicall3: MULTICALL3,
    decimals: VAULT_DECIMALS,
    chainKey: "ethereum",
    explorerUrl: "https://etherscan.io",
  }),
  137: Object.freeze({
    chainId: 137,
    // Polygon PoS sees one-block reorgs routinely; wait for a few blocks.
    confirmations: 3,
    vault: VAULT,
    stable: EUSD,
    // Native USDC, not the bridged USDC.e.
    gem: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    multicall3: MULTICALL3,
    decimals: VAULT_DECIMALS,
    chainKey: "polygon",
    explorerUrl: "https://polygonscan.com",
  }),
  8453: Object.freeze({
    chainId: 8453,
    confirmations: 1,
    vault: VAULT,
    stable: EUSD,
    gem: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    multicall3: MULTICALL3,
    decimals: VAULT_DECIMALS,
    chainKey: "base",
    explorerUrl: "https://basescan.org",
  }),
});

export function isVaultChainId(id: number | undefined): id is VaultChainId {
  return id !== undefined && (VAULT_CHAIN_IDS as readonly number[]).includes(id);
}

export function getVaultDeployment(id: number | undefined): VaultDeployment | undefined {
  return isVaultChainId(id) ? VAULT_DEPLOYMENTS[id] : undefined;
}

/** A token's side of the vault: eUSD is `STABLE()`, USDC is `GEM()`. */
export type VaultSide = "stable" | "gem";

export type SwapRoute = Readonly<{
  direction: SwapDirection;
  /** The side the input token is on, which keys its address, balance and allowance. */
  inputSide: VaultSide;
  /** The side the output token is on, which keys its address and balance. */
  outputSide: VaultSide;
  tokenIn: Address;
  tokenOut: Address;
  symbolIn: "USDC" | "eUSD";
  symbolOut: "USDC" | "eUSD";
  swapFunction: "sellGem" | "buyGem";
  previewFunction: "previewSellGem" | "previewBuyGem";
  /** The `getReserves()` output the swap draws from. */
  outputReserve: "stableReserve" | "gemReserve";
}>;

/** The part of a route that is the same on every chain. */
export type DirectionRoute = Omit<SwapRoute, "tokenIn" | "tokenOut">;

const USDC_TO_EUSD: DirectionRoute = Object.freeze({
  direction: "usdcToEusd",
  inputSide: "gem",
  outputSide: "stable",
  symbolIn: "USDC",
  symbolOut: "eUSD",
  swapFunction: "sellGem",
  previewFunction: "previewSellGem",
  outputReserve: "stableReserve",
});

const EUSD_TO_USDC: DirectionRoute = Object.freeze({
  direction: "eusdToUsdc",
  inputSide: "stable",
  outputSide: "gem",
  symbolIn: "eUSD",
  symbolOut: "USDC",
  swapFunction: "buyGem",
  previewFunction: "previewBuyGem",
  outputReserve: "gemReserve",
});

/** A direction's route without its token addresses, for callers that have no deployment. */
export function directionRoute(direction: SwapDirection): DirectionRoute {
  if (direction === "usdcToEusd") return USDC_TO_EUSD;
  if (direction === "eusdToUsdc") return EUSD_TO_USDC;
  // Unreachable for typed callers; a direction read back from storage must not fall into either branch.
  throw new Error("Unknown swap direction");
}

export function routeFor(d: VaultDeployment, direction: SwapDirection): SwapRoute {
  const route = directionRoute(direction);
  return Object.freeze({ ...route, tokenIn: d[route.inputSide], tokenOut: d[route.outputSide] });
}
