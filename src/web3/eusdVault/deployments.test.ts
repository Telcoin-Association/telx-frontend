/** @jest-environment node */
import { getAddress, zeroAddress } from "viem";
import {
  VAULT_CHAIN_IDS,
  VAULT_DECIMALS,
  VAULT_DEPLOYMENTS,
  getVaultDeployment,
  isVaultChainId,
  routeFor,
  type SwapDirection,
} from "./deployments";

// Every literal is repeated here on purpose. Changing an address in deployments.ts must fail this test until the
// change is made here as well.
const VAULT = "0xc72178D412256a6Dc5f04D749859b4cd95076d61";
const EUSD = "0x14913815bCFDE78BAeAd2111F463D038Ac9C2949";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const USDC = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

const PINNED = {
  1: {
    chainId: 1,
    confirmations: 1,
    vault: VAULT,
    stable: EUSD,
    gem: USDC[1],
    multicall3: MULTICALL3,
    decimals: 6,
    chainKey: "ethereum",
    explorerUrl: "https://etherscan.io",
  },
  137: {
    chainId: 137,
    confirmations: 3,
    vault: VAULT,
    stable: EUSD,
    gem: USDC[137],
    multicall3: MULTICALL3,
    decimals: 6,
    chainKey: "polygon",
    explorerUrl: "https://polygonscan.com",
  },
  8453: {
    chainId: 8453,
    confirmations: 1,
    vault: VAULT,
    stable: EUSD,
    gem: USDC[8453],
    multicall3: MULTICALL3,
    decimals: 6,
    chainKey: "base",
    explorerUrl: "https://basescan.org",
  },
} as const;

const deployments = Object.values(VAULT_DEPLOYMENTS);

describe("pinned eUSD vault deployments", () => {
  it("matches the reviewed literals exactly", () => {
    expect(VAULT_DEPLOYMENTS).toEqual(PINNED);
  });

  it("covers exactly the supported chain ids in display order, keyed by chain id", () => {
    expect(VAULT_CHAIN_IDS).toEqual([1, 137, 8453]);
    expect(Object.keys(VAULT_DEPLOYMENTS).map(Number).sort()).toEqual([...VAULT_CHAIN_IDS].sort());
    for (const [key, deployment] of Object.entries(VAULT_DEPLOYMENTS)) {
      expect(deployment.chainId).toBe(Number(key));
    }
  });

  it.each([1, 137, 8453] as const)("pins native USDC on chain %i", (chainId) => {
    expect(VAULT_DEPLOYMENTS[chainId].gem).toBe(USDC[chainId]);
  });

  it("uses one vault, one eUSD and Multicall3 on every chain", () => {
    for (const deployment of deployments) {
      expect(deployment.vault).toBe(VAULT);
      expect(deployment.stable).toBe(EUSD);
      expect(deployment.multicall3).toBe(MULTICALL3);
    }
  });

  it("uses 6 decimals everywhere", () => {
    expect(VAULT_DECIMALS).toBe(6);
    for (const deployment of deployments) {
      expect(deployment.decimals).toBe(6);
    }
  });

  it("uses checksummed, non-zero addresses everywhere", () => {
    for (const deployment of deployments) {
      for (const address of [deployment.vault, deployment.stable, deployment.gem, deployment.multicall3]) {
        expect(getAddress(address)).toBe(address);
        expect(address.toLowerCase()).not.toBe(zeroAddress);
      }
    }
  });

  it("assigns four distinct roles on every chain", () => {
    for (const deployment of deployments) {
      const distinct = new Set(
        [deployment.vault, deployment.stable, deployment.gem, deployment.multicall3].map((a) => a.toLowerCase())
      );
      expect(distinct.size).toBe(4);
    }
  });

  it("waits for extra confirmations only on Polygon", () => {
    for (const deployment of deployments) {
      expect(Number.isInteger(deployment.confirmations)).toBe(true);
      expect(deployment.confirmations).toBe(deployment.chainId === 137 ? 3 : 1);
    }
  });

  it("links each chain to its explorer without a trailing slash", () => {
    for (const deployment of deployments) {
      expect(deployment.explorerUrl).toMatch(/^https:\/\/[a-z.]+$/);
    }
  });

  it("is frozen at every level", () => {
    expect(Object.isFrozen(VAULT_DEPLOYMENTS)).toBe(true);
    expect(Object.isFrozen(VAULT_CHAIN_IDS)).toBe(true);
    for (const deployment of deployments) {
      expect(Object.isFrozen(deployment)).toBe(true);
    }
    expect(() => {
      (VAULT_DEPLOYMENTS[137] as { vault: string }).vault = zeroAddress;
    }).toThrow(TypeError);
    expect(VAULT_DEPLOYMENTS[137].vault).toBe(VAULT);
  });
});

describe("isVaultChainId and getVaultDeployment", () => {
  it("recognises the supported chain ids", () => {
    for (const chainId of VAULT_CHAIN_IDS) {
      expect(isVaultChainId(chainId)).toBe(true);
      expect(getVaultDeployment(chainId)).toBe(VAULT_DEPLOYMENTS[chainId]);
    }
  });

  it.each([undefined, 0, 56, 10, 11155111, 84532, Number.NaN, 1.5])("rejects %p", (chainId) => {
    expect(isVaultChainId(chainId)).toBe(false);
    expect(getVaultDeployment(chainId)).toBeUndefined();
  });
});

describe("routeFor", () => {
  it.each(VAULT_CHAIN_IDS)("sells USDC for eUSD on chain %i", (chainId) => {
    const deployment = VAULT_DEPLOYMENTS[chainId];

    expect(routeFor(deployment, "usdcToEusd")).toEqual({
      direction: "usdcToEusd",
      tokenIn: USDC[chainId],
      tokenOut: EUSD,
      symbolIn: "USDC",
      symbolOut: "eUSD",
      swapFunction: "sellGem",
      previewFunction: "previewSellGem",
      outputReserve: "stableReserve",
    });
  });

  it.each(VAULT_CHAIN_IDS)("buys USDC with eUSD on chain %i", (chainId) => {
    const deployment = VAULT_DEPLOYMENTS[chainId];

    expect(routeFor(deployment, "eusdToUsdc")).toEqual({
      direction: "eusdToUsdc",
      tokenIn: EUSD,
      tokenOut: USDC[chainId],
      symbolIn: "eUSD",
      symbolOut: "USDC",
      swapFunction: "buyGem",
      previewFunction: "previewBuyGem",
      outputReserve: "gemReserve",
    });
  });

  it("returns a frozen route", () => {
    expect(Object.isFrozen(routeFor(VAULT_DEPLOYMENTS[1], "usdcToEusd"))).toBe(true);
  });

  it("throws on a direction outside the type", () => {
    expect(() => routeFor(VAULT_DEPLOYMENTS[1], "usdcToUsdc" as SwapDirection)).toThrow("Unknown swap direction");
  });
});
