import React, { type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import {
  defaultScheduler,
  focusManager,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { decodeFunctionData, encodeFunctionResult, zeroAddress, type Address, type Hex } from "viem";
import { erc20Abi, multicall3Abi, vaultAbi } from "@/web3/eusdVault/abis";
import { VAULT_DEPLOYMENTS } from "@/web3/eusdVault/deployments";
import { describeError, QuoteUnavailableError, VaultIdentityError } from "@/web3/eusdVault/errors";
import { buildPageStateCalls } from "@/web3/eusdVault/reads";
import type {
  ChainSource,
  Multicall3Call,
  Multicall3Result,
  SettleObservation,
  SwapDirection,
  VaultDeployment,
} from "@/web3/eusdVault/types";
import {
  QUOTE_DEBOUNCE_MS,
  STALE_READ_LIMIT_MS,
  useVaultState,
  VAULT_REFRESH_MS,
  type VaultStateInput,
} from "./useVaultState";

const POLYGON = VAULT_DEPLOYMENTS[137];
const ETHEREUM = VAULT_DEPLOYMENTS[1];
const ALICE: Address = "0x1111111111111111111111111111111111111111";
const BOB: Address = "0x2222222222222222222222222222222222222222";
const OTHER: Address = "0x9999999999999999999999999999999999999999";
const NOW = 1_700_000_000_000;

type Holdings = Readonly<{ eUSD: bigint; USDC: bigint; eUSDAllowance: bigint; USDCAllowance: bigint }>;

/** What the fake chain answers. Mutable between reads. */
type FakeChain = {
  chainId: bigint;
  blockNumber: bigint;
  stable: Address;
  gem: Address;
  vaultPaused: boolean;
  stablePaused: boolean;
  stableReserve: bigint;
  gemReserve: bigint;
  maxPerTransaction: bigint;
  maxPerBlock: bigint;
  tin: bigint;
  tout: bigint;
  wallets: Record<string, Holdings>;
  /** Sub-calls that fail, as `target.function` (`vault.paused`, `eUSD.paused`, `vault.previewSellGem`, ...). */
  failing: string[];
};

const EMPTY: Holdings = { eUSD: 0n, USDC: 0n, eUSDAllowance: 0n, USDCAllowance: 0n };

function healthyChain(d: VaultDeployment = POLYGON): FakeChain {
  return {
    chainId: BigInt(d.chainId),
    blockNumber: 1_000n,
    stable: d.stable,
    gem: d.gem,
    vaultPaused: false,
    stablePaused: false,
    stableReserve: 5_000_000_000n,
    gemReserve: 7_000_000_000n,
    maxPerTransaction: 1_000_000_000n,
    maxPerBlock: 3_000_000_000n,
    tin: 1_000_000_000_000_000n,
    tout: 2_000_000_000_000_000n,
    wallets: {
      [ALICE.toLowerCase()]: { eUSD: 11_000_000n, USDC: 22_000_000n, eUSDAllowance: 33n, USDCAllowance: 44n },
      [BOB.toLowerCase()]: { eUSD: 55_000_000n, USDC: 66_000_000n, eUSDAllowance: 77n, USDCAllowance: 88n },
    },
    failing: [],
  };
}

/** The preview's answer: a 0.1% fee, doubled for the zero-address recipient so the test can tell them apart. */
function previewOf(amountIn: bigint, recipient: Address): readonly [bigint, bigint] {
  const fee = (amountIn / 1_000n) * (recipient === zeroAddress ? 2n : 1n);
  return [amountIn - fee, fee];
}

function targetName(d: VaultDeployment, target: Address): string {
  const t = target.toLowerCase();
  if (t === d.multicall3.toLowerCase()) return "multicall3";
  if (t === d.vault.toLowerCase()) return "vault";
  if (t === d.stable.toLowerCase()) return "eUSD";
  if (t === d.gem.toLowerCase()) return "USDC";
  throw new Error(`Unexpected target ${target}`);
}

function holdings(chain: FakeChain, owner: Address): Holdings {
  return chain.wallets[owner.toLowerCase()] ?? EMPTY;
}

function answerMulticall3(chain: FakeChain, data: Hex): Hex {
  const { functionName } = decodeFunctionData({ abi: multicall3Abi, data });
  if (functionName === "getChainId") {
    return encodeFunctionResult({ abi: multicall3Abi, functionName, result: chain.chainId });
  }
  if (functionName === "getBlockNumber") {
    return encodeFunctionResult({ abi: multicall3Abi, functionName, result: chain.blockNumber });
  }
  throw new Error(`Unexpected Multicall3 call ${functionName}`);
}

function answerVault(chain: FakeChain, data: Hex): Hex {
  const call = decodeFunctionData({ abi: vaultAbi, data });
  switch (call.functionName) {
    case "STABLE":
      return encodeFunctionResult({ abi: vaultAbi, functionName: "STABLE", result: chain.stable });
    case "GEM":
      return encodeFunctionResult({ abi: vaultAbi, functionName: "GEM", result: chain.gem });
    case "paused":
      return encodeFunctionResult({ abi: vaultAbi, functionName: "paused", result: chain.vaultPaused });
    case "getReserves":
      return encodeFunctionResult({
        abi: vaultAbi,
        functionName: "getReserves",
        result: [chain.stableReserve, chain.gemReserve],
      });
    case "maxPerTransaction":
    case "maxPerBlock":
    case "tin":
    case "tout":
      return encodeFunctionResult({ abi: vaultAbi, functionName: call.functionName, result: chain[call.functionName] });
    case "previewSellGem":
    case "previewBuyGem": {
      const [amountIn, recipient] = call.args;
      return encodeFunctionResult({
        abi: vaultAbi,
        functionName: call.functionName,
        result: previewOf(amountIn, recipient),
      });
    }
    default:
      throw new Error(`Unexpected vault call ${call.functionName}`);
  }
}

function answerToken(chain: FakeChain, d: VaultDeployment, token: "eUSD" | "USDC", data: Hex): Hex {
  const call = decodeFunctionData({ abi: erc20Abi, data });
  switch (call.functionName) {
    case "paused":
      if (token !== "eUSD") throw new Error("USDC.paused is not read");
      return encodeFunctionResult({ abi: erc20Abi, functionName: "paused", result: chain.stablePaused });
    case "balanceOf": {
      const [owner] = call.args;
      return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: holdings(chain, owner)[token] });
    }
    case "allowance": {
      const [owner, spender] = call.args;
      if (spender.toLowerCase() !== d.vault.toLowerCase()) throw new Error("The spender must be the vault");
      const h = holdings(chain, owner);
      return encodeFunctionResult({
        abi: erc20Abi,
        functionName: "allowance",
        result: token === "eUSD" ? h.eUSDAllowance : h.USDCAllowance,
      });
    }
    default:
      throw new Error(`Unexpected token call ${call.functionName}`);
  }
}

function answer(chain: FakeChain, d: VaultDeployment, call: Multicall3Call): Multicall3Result {
  const target = targetName(d, call.target);
  const { functionName } = decodeFunctionData({ abi: [...multicall3Abi, ...vaultAbi, ...erc20Abi], data: call.callData });
  if (chain.failing.includes(`${target}.${functionName}`)) return { success: false, returnData: "0x" };
  const returnData =
    target === "multicall3"
      ? answerMulticall3(chain, call.callData)
      : target === "vault"
        ? answerVault(chain, call.callData)
        : answerToken(chain, d, target === "eUSD" ? "eUSD" : "USDC", call.callData);
  return { success: true, returnData };
}

type FakeSource = ChainSource & {
  aggregate3: jest.Mock<Promise<readonly Multicall3Result[]>, [Address, readonly Multicall3Call[], bigint?]>;
  /** Holds every read until `release` is called. */
  hold(): void;
  release(): void;
  /** Makes every read reject with `error` until cleared. */
  failWith(error: unknown): void;
};

function fakeSource(chain: FakeChain, d: VaultDeployment = POLYGON): FakeSource {
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  let failure: { error: unknown } | undefined;
  const aggregate3 = jest.fn(async (multicall3: Address, calls: readonly Multicall3Call[]) => {
    if (multicall3 !== d.multicall3) throw new Error("Wrong Multicall3");
    const results = calls.map((call) => answer(chain, d, call));
    const pending = failure;
    await gate;
    if (pending) throw pending.error;
    return results;
  });
  return {
    aggregate3,
    getBlockNumber: jest.fn(async () => chain.blockNumber),
    simulateSwap: jest.fn(async () => 0n),
    getCode: jest.fn(async () => undefined),
    hold() {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release() {
      open?.();
      gate = undefined;
    },
    failWith(error) {
      failure = error === undefined ? undefined : { error };
    },
  };
}

const clients: QueryClient[] = [];

function setup(initialProps: VaultStateInput) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook((props: VaultStateInput) => useVaultState(props), { initialProps, wrapper });
}

/** Lets resolved reads land and react-query's batched notifications render. */
async function flush() {
  for (let n = 0; n < 5; n += 1) {
    await act(() => jest.advanceTimersByTimeAsync(0));
  }
}

const advance = async (ms: number) => {
  await act(() => jest.advanceTimersByTimeAsync(ms));
  await flush();
};

function input(source: ChainSource | undefined, overrides: Partial<VaultStateInput> = {}): VaultStateInput {
  return { deployment: POLYGON, direction: "usdcToEusd", source, ...overrides };
}

// Fake timers push a zero-delay timeout set during a tick 1 ms later, so react-query's batched notifications would
// wait for the clock to move. Delivering them as microtasks keeps the millisecond checks below exact.
beforeAll(() => {
  notifyManager.setScheduler(queueMicrotask);
});

afterAll(() => {
  notifyManager.setScheduler(defaultScheduler);
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  focusManager.setFocused(undefined);
  jest.useRealTimers();
});

describe("useVaultState", () => {
  describe("reads", () => {
    it.each([
      { name: "disconnected without an amount", owner: undefined, amountIn: undefined, calls: 11 },
      { name: "disconnected with an amount", owner: undefined, amountIn: 1_000_000n, calls: 12 },
      { name: "connected without an amount", owner: ALICE, amountIn: undefined, calls: 15 },
      { name: "connected with an amount", owner: ALICE, amountIn: 1_000_000n, calls: 16 },
    ])("sends one aggregate3 of $calls calls when $name", async ({ owner, amountIn, calls }) => {
      const source = fakeSource(healthyChain());
      setup(input(source, { owner, amountIn }));
      await flush();

      expect(source.aggregate3).toHaveBeenCalledTimes(1);
      const [multicall3, sent, blockNumber] = source.aggregate3.mock.calls[0];
      expect(multicall3).toBe(POLYGON.multicall3);
      expect(sent).toHaveLength(calls);
      expect(sent).toEqual(buildPageStateCalls(POLYGON, "usdcToEusd", owner, amountIn));
      expect(blockNumber).toBeUndefined();
      expect(source.getBlockNumber).not.toHaveBeenCalled();
      expect(source.simulateSwap).not.toHaveBeenCalled();
    });

    it("is verifying until the first read lands", async () => {
      const source = fakeSource(healthyChain());
      source.hold();
      const { result } = setup(input(source, { owner: ALICE }));
      await flush();

      expect(result.current.isVerifying).toBe(true);
      expect(result.current.state).toBeUndefined();
      expect(result.current.isContractVerified).toBe(false);
      expect(result.current.isSecurityCheckUnavailable).toBe(false);
      expect(result.current.paused).toBe(true);
      expect(result.current.error).toBeUndefined();
      expect(result.current.updatedAt).toBeUndefined();

      source.release();
      await flush();
      expect(result.current.isVerifying).toBe(false);
      expect(result.current.isContractVerified).toBe(true);
    });

    it("exposes a verified read", async () => {
      const source = fakeSource(healthyChain());
      const { result } = setup(input(source, { owner: ALICE }));
      await flush();

      expect(result.current).toMatchObject({
        isVerifying: false,
        isContractVerified: true,
        isSecurityCheckUnavailable: false,
        isStale: false,
        paused: false,
        quote: { status: "idle" },
        updatedAt: NOW,
      });
      expect(result.current.error).toBeUndefined();
      expect(result.current.state).toEqual({
        chainId: 137,
        blockNumber: 1_000n,
        stable: POLYGON.stable,
        gem: POLYGON.gem,
        vaultPaused: false,
        stablePaused: false,
        stableReserve: 5_000_000_000n,
        gemReserve: 7_000_000_000n,
        maxPerTransaction: 1_000_000_000n,
        maxPerBlock: 3_000_000_000n,
        tin: 1_000_000_000_000_000n,
        tout: 2_000_000_000_000_000n,
        quote: undefined,
        balances: { stable: 11_000_000n, gem: 22_000_000n },
        allowances: { stable: 33n, gem: 44n },
      });
    });

    it("reads a disconnected visitor's vault state without balances and still quotes", async () => {
      const source = fakeSource(healthyChain());
      const { result } = setup(input(source, { amountIn: 1_000_000n }));
      await flush();

      expect(result.current.isContractVerified).toBe(true);
      expect(result.current.state?.balances).toBeUndefined();
      expect(result.current.state?.allowances).toBeUndefined();
      expect(result.current.state?.stableReserve).toBe(5_000_000_000n);
      // The zero-address recipient's fee, so the preview was asked for no wallet.
      expect(result.current.quote).toEqual({
        status: "ready",
        direction: "usdcToEusd",
        amountIn: 1_000_000n,
        quote: { amountOut: 998_000n, fee: 2_000n },
      });
    });

    it("quotes a connected wallet with its own address as recipient", async () => {
      const source = fakeSource(healthyChain());
      const { result } = setup(input(source, { owner: ALICE, amountIn: 1_000_000n }));
      await flush();

      expect(result.current.quote).toEqual({
        status: "ready",
        direction: "usdcToEusd",
        amountIn: 1_000_000n,
        quote: { amountOut: 999_000n, fee: 1_000n },
      });
    });
  });

  describe("identity gate", () => {
    it.each([
      {
        name: "chain id",
        change: (c: FakeChain) => {
          c.chainId = 1n;
        },
        error: new VaultIdentityError("chain"),
      },
      {
        name: "STABLE",
        change: (c: FakeChain) => {
          c.stable = OTHER;
        },
        error: new VaultIdentityError("contracts"),
      },
      {
        name: "GEM",
        change: (c: FakeChain) => {
          c.gem = OTHER;
        },
        error: new VaultIdentityError("contracts"),
      },
    ])("fails closed with no state when the $name does not match", async ({ change, error }) => {
      const chain = healthyChain();
      change(chain);
      const source = fakeSource(chain);
      const { result } = setup(input(source, { owner: ALICE, amountIn: 1_000_000n }));
      await flush();

      expect(result.current.state).toBeUndefined();
      expect(result.current.isContractVerified).toBe(false);
      expect(result.current.isSecurityCheckUnavailable).toBe(true);
      expect(result.current.isVerifying).toBe(false);
      expect(result.current.paused).toBe(true);
      expect(result.current.error).toEqual(describeError(error));
      expect(result.current.quote.status).toBe("error");
      expect(result.current.updatedAt).toBeUndefined();

      // A mismatch is not retried.
      await advance(5_000);
      expect(source.aggregate3).toHaveBeenCalledTimes(1);
    });

    it("drops a verified state when a later read no longer matches", async () => {
      const chain = healthyChain();
      const source = fakeSource(chain);
      const { result } = setup(input(source, { owner: ALICE }));
      await flush();
      expect(result.current.isContractVerified).toBe(true);

      chain.gem = OTHER;
      await advance(VAULT_REFRESH_MS);

      expect(result.current.state).toBeUndefined();
      expect(result.current.isContractVerified).toBe(false);
      expect(result.current.isSecurityCheckUnavailable).toBe(true);
      expect(result.current.paused).toBe(true);
    });
  });

  describe("paused", () => {
    it.each([
      { name: "the vault's", flag: "vaultPaused" as const },
      { name: "eUSD's", flag: "stablePaused" as const },
    ])("is paused when $name flag is set", async ({ flag }) => {
      const chain = healthyChain();
      chain[flag] = true;
      const { result } = setup(input(fakeSource(chain), { owner: ALICE }));
      await flush();

      expect(result.current.isContractVerified).toBe(true);
      expect(result.current.paused).toBe(true);
    });

    it.each([
      { name: "vault.paused", flag: "vaultPaused" as const },
      { name: "eUSD.paused", flag: "stablePaused" as const },
    ])("reads a failed $name sub-call as paused", async ({ name, flag }) => {
      const chain = healthyChain();
      chain.failing = [name];
      const { result } = setup(input(fakeSource(chain), { owner: ALICE }));
      await flush();

      expect(result.current.isContractVerified).toBe(true);
      expect(result.current.state?.[flag]).toBe(true);
      expect(result.current.paused).toBe(true);
    });
  });

  describe("failures", () => {
    it("reports a thrown aggregate3 without leaking the raw message and asks once per refresh", async () => {
      const source = fakeSource(healthyChain());
      source.failWith(new Error("HTTP request failed.\nURL: https://polygon-mainnet.g.alchemy.com/v2/secret-key"));
      const { result } = setup(input(source, { owner: ALICE, amountIn: 1_000_000n }));
      await flush();

      expect(source.aggregate3).toHaveBeenCalledTimes(1);
      expect(result.current.isSecurityCheckUnavailable).toBe(true);
      expect(result.current.isContractVerified).toBe(false);
      expect(result.current.isVerifying).toBe(false);
      expect(result.current.state).toBeUndefined();
      expect(result.current.paused).toBe(true);
      expect(result.current.error).toEqual({ tone: "error", message: "Security verification failed" });
      expect(result.current.quote).toEqual({ status: "error", error: result.current.error });

      // The transport retries each request itself, so the hook never asks again before the next refresh.
      await advance(VAULT_REFRESH_MS - 1);
      expect(source.aggregate3).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(source.aggregate3).toHaveBeenCalledTimes(2);
      await advance(VAULT_REFRESH_MS);
      expect(source.aggregate3).toHaveBeenCalledTimes(3);
    });

    /** A verified read at NOW, then a refresh that fails. */
    async function failAfterVerifiedRead(overrides: Partial<VaultStateInput> = {}) {
      const chain = healthyChain();
      const source = fakeSource(chain);
      const { result, rerender } = setup(input(source, { owner: ALICE, ...overrides }));
      await flush();
      const verified = result.current.state;
      const quote = result.current.quote;
      expect(result.current.isContractVerified).toBe(true);

      source.failWith(Object.assign(new Error("boom"), { shortMessage: "The request took too long to respond." }));
      await advance(VAULT_REFRESH_MS);
      return { result, rerender, chain, source, verified, quote };
    }

    it("keeps the form on a verified read through a failed refresh within the limit", async () => {
      const { result, rerender, source, verified, quote } = await failAfterVerifiedRead({ amountIn: 1_000_000n });

      expect(quote.status).toBe("ready");
      expect(result.current).toMatchObject({
        isStale: true,
        isContractVerified: true,
        isSecurityCheckUnavailable: false,
        isVerifying: false,
        paused: false,
        updatedAt: NOW,
      });
      expect(result.current.state).toBe(verified);
      // The read was made for exactly this direction and amount, so its quote stands.
      expect(result.current.quote).toEqual(quote);
      expect(result.current.error).toEqual({ tone: "error", message: "The request took too long to respond." });

      // Another amount has no read behind it, before and after its own read fails.
      rerender(input(source, { owner: ALICE, amountIn: 2_000_000n }));
      expect(result.current.quote).toEqual({ status: "error", error: result.current.error });
      await advance(QUOTE_DEBOUNCE_MS);
      expect(source.aggregate3.mock.calls.at(-1)?.[1]).toEqual(
        buildPageStateCalls(POLYGON, "usdcToEusd", ALICE, 2_000_000n)
      );
      expect(result.current).toMatchObject({ isStale: true, isContractVerified: true, isSecurityCheckUnavailable: false });
      expect(result.current.state).toBe(verified);
      expect(result.current.quote).toEqual({ status: "error", error: result.current.error });
    });

    it("stops vouching for the kept read once it is STALE_READ_LIMIT_MS old, with no further request failing", async () => {
      const { result, source, verified } = await failAfterVerifiedRead();
      expect(result.current.isStale).toBe(true);

      // Every later refresh hangs, so only the clock can end the stale read.
      source.hold();
      const calls = source.aggregate3.mock.calls.length;
      await advance(NOW + STALE_READ_LIMIT_MS - 1 - Date.now());
      expect(result.current).toMatchObject({ isStale: true, isContractVerified: true, isSecurityCheckUnavailable: false });
      expect(source.aggregate3).toHaveBeenCalledTimes(calls + 1);

      await advance(1);
      expect(result.current).toMatchObject({
        isStale: false,
        isContractVerified: false,
        isSecurityCheckUnavailable: true,
        isVerifying: false,
      });
      expect(result.current.state).toBe(verified);
      expect(source.aggregate3).toHaveBeenCalledTimes(calls + 1);
    });

    it("drops a kept read at once when a read fails the identity check, and a later failure does not restore it", async () => {
      const { result, chain, source } = await failAfterVerifiedRead();
      expect(result.current.isStale).toBe(true);

      source.failWith(undefined);
      chain.gem = OTHER;
      await advance(VAULT_REFRESH_MS);
      expect(result.current.state).toBeUndefined();
      expect(result.current).toMatchObject({
        isStale: false,
        isContractVerified: false,
        isSecurityCheckUnavailable: true,
        paused: true,
      });
      expect(result.current.error).toEqual(describeError(new VaultIdentityError("contracts")));

      source.failWith(new Error("down"));
      await advance(VAULT_REFRESH_MS);
      expect(result.current.state).toBeUndefined();
      expect(result.current.updatedAt).toBeUndefined();
      expect(result.current).toMatchObject({ isStale: false, isContractVerified: false, isSecurityCheckUnavailable: true });
    });

    it("clears isStale when a refresh succeeds", async () => {
      const { result, source } = await failAfterVerifiedRead();
      expect(result.current.isStale).toBe(true);

      source.failWith(undefined);
      await advance(VAULT_REFRESH_MS);
      expect(result.current).toMatchObject({ isStale: false, isContractVerified: true, isSecurityCheckUnavailable: false });
      expect(result.current.error).toBeUndefined();
      expect(result.current.updatedAt).toBeGreaterThan(NOW);
    });

    it("reports a malformed read with the decoder's message", async () => {
      const source = fakeSource(healthyChain());
      source.aggregate3.mockResolvedValue([]);
      const { result } = setup(input(source, { owner: ALICE }));
      await flush();

      expect(result.current.isSecurityCheckUnavailable).toBe(true);
      expect(result.current.error).toEqual({
        tone: "error",
        message: "The vault's state could not be read. Try again shortly.",
      });
    });

    it("is unavailable without a source and calls nothing", async () => {
      const source = fakeSource(healthyChain());
      const { result, rerender } = setup(input(undefined, { owner: ALICE, amountIn: 1_000_000n }));
      await flush();

      expect(result.current).toMatchObject({
        isVerifying: false,
        isContractVerified: false,
        isSecurityCheckUnavailable: true,
        paused: true,
        quote: { status: "error" },
      });
      expect(result.current.state).toBeUndefined();
      expect(result.current.error).toBeUndefined();
      let observation: SettleObservation | undefined;
      await act(async () => {
        observation = await result.current.refetch();
      });
      expect(observation).toEqual({});

      rerender(input(source, { owner: ALICE, amountIn: 1_000_000n }));
      await flush();
      expect(source.aggregate3).toHaveBeenCalledTimes(1);
      expect(result.current.isContractVerified).toBe(true);
    });
  });

  describe("quote", () => {
    it("goes idle, loading while typing, ready after the debounce, and loading again on every change", async () => {
      const source = fakeSource(healthyChain());
      const { result, rerender } = setup(input(source, { owner: ALICE }));
      await flush();
      expect(result.current.quote).toEqual({ status: "idle" });
      expect(source.aggregate3).toHaveBeenCalledTimes(1);

      rerender(input(source, { owner: ALICE, amountIn: 1_000_000n }));
      expect(result.current.quote).toEqual({ status: "loading" });
      await advance(QUOTE_DEBOUNCE_MS - 1);
      expect(result.current.quote).toEqual({ status: "loading" });
      expect(source.aggregate3).toHaveBeenCalledTimes(1);

      source.hold();
      await advance(1);
      expect(source.aggregate3).toHaveBeenCalledTimes(2);
      // In flight: the previous read stays, the quote does not.
      expect(result.current.quote).toEqual({ status: "loading" });
      expect(result.current.state?.balances).toEqual({ stable: 11_000_000n, gem: 22_000_000n });
      expect(result.current.isContractVerified).toBe(true);
      source.release();
      await flush();
      expect(result.current.quote).toEqual({
        status: "ready",
        direction: "usdcToEusd",
        amountIn: 1_000_000n,
        quote: { amountOut: 999_000n, fee: 1_000n },
      });

      rerender(input(source, { owner: ALICE, amountIn: 2_000_000n }));
      expect(result.current.quote).toEqual({ status: "loading" });
      await advance(QUOTE_DEBOUNCE_MS - 1);
      expect(result.current.quote).toEqual({ status: "loading" });
      await advance(1);
      expect(result.current.quote).toEqual({
        status: "ready",
        direction: "usdcToEusd",
        amountIn: 2_000_000n,
        quote: { amountOut: 1_998_000n, fee: 2_000n },
      });
      expect(source.aggregate3).toHaveBeenCalledTimes(3);

      // A direction change reads at once, with no debounce, and never shows the other direction's quote.
      source.hold();
      rerender(input(source, { owner: ALICE, amountIn: 2_000_000n, direction: "eusdToUsdc" }));
      expect(result.current.quote).toEqual({ status: "loading" });
      await flush();
      expect(source.aggregate3).toHaveBeenCalledTimes(4);
      expect(source.aggregate3.mock.calls[3][1]).toEqual(
        buildPageStateCalls(POLYGON, "eusdToUsdc", ALICE, 2_000_000n)
      );
      expect(result.current.quote).toEqual({ status: "loading" });
      source.release();
      await flush();
      expect(result.current.quote).toEqual({
        status: "ready",
        direction: "eusdToUsdc",
        amountIn: 2_000_000n,
        quote: { amountOut: 1_998_000n, fee: 2_000n },
      });

      // A cleared amount leaves the key at once, so the next read stops previewing it.
      rerender(input(source, { owner: ALICE, direction: "eusdToUsdc" }));
      expect(result.current.quote).toEqual({ status: "idle" });
      await flush();
      expect(source.aggregate3).toHaveBeenCalledTimes(5);
      expect(source.aggregate3.mock.calls[4][1]).toHaveLength(15);
      expect(result.current.quote).toEqual({ status: "idle" });
    });

    it("reads only the last amount typed within the debounce", async () => {
      const source = fakeSource(healthyChain());
      const { result, rerender } = setup(input(source, { owner: ALICE }));
      await flush();

      for (const amountIn of [1n, 12n, 123n]) {
        rerender(input(source, { owner: ALICE, amountIn }));
        await advance(QUOTE_DEBOUNCE_MS / 2);
      }
      await advance(QUOTE_DEBOUNCE_MS);

      expect(source.aggregate3).toHaveBeenCalledTimes(2);
      expect(source.aggregate3.mock.calls[1][1]).toEqual(buildPageStateCalls(POLYGON, "usdcToEusd", ALICE, 123n));
      expect(result.current.quote).toMatchObject({ status: "ready", amountIn: 123n });
    });

    it("reports a failed preview as a quote error while the rest of the read stands", async () => {
      const chain = healthyChain();
      chain.failing = ["vault.previewBuyGem"];
      const { result } = setup(
        input(fakeSource(chain), { owner: ALICE, amountIn: 1_000_000n, direction: "eusdToUsdc" })
      );
      await flush();

      expect(result.current.isContractVerified).toBe(true);
      expect(result.current.state?.quote).toBeUndefined();
      expect(result.current.quote).toEqual({ status: "error", error: describeError(new QuoteUnavailableError()) });
    });

    it("treats a zero amount as no amount", async () => {
      const source = fakeSource(healthyChain());
      const { result } = setup(input(source, { owner: ALICE, amountIn: 0n }));
      await flush();

      expect(result.current.quote).toEqual({ status: "idle" });
      expect(source.aggregate3.mock.calls[0][1]).toHaveLength(15);
    });
  });

  describe("wallet and chain changes", () => {
    it("drops the previous owner's balances in the same render and reads the new owner at once", async () => {
      const source = fakeSource(healthyChain());
      const { result, rerender } = setup(input(source, { owner: ALICE }));
      await flush();
      expect(result.current.state?.balances).toEqual({ stable: 11_000_000n, gem: 22_000_000n });

      source.hold();
      rerender(input(source, { owner: BOB }));
      expect(result.current.state).toBeUndefined();
      expect(result.current.isVerifying).toBe(true);
      expect(result.current.isContractVerified).toBe(false);
      expect(result.current.paused).toBe(true);
      expect(result.current.updatedAt).toBeUndefined();
      await flush();
      expect(result.current.state).toBeUndefined();
      expect(source.aggregate3).toHaveBeenCalledTimes(2);

      source.release();
      await flush();
      expect(result.current.state?.balances).toEqual({ stable: 55_000_000n, gem: 66_000_000n });
      expect(result.current.state?.allowances).toEqual({ stable: 77n, gem: 88n });
    });

    it("drops the wallet's balances on disconnect", async () => {
      const source = fakeSource(healthyChain());
      const { result, rerender } = setup(input(source, { owner: ALICE }));
      await flush();

      source.hold();
      rerender(input(source));
      expect(result.current.state).toBeUndefined();
      source.release();
      await flush();
      expect(result.current.state?.balances).toBeUndefined();
      expect(result.current.isContractVerified).toBe(true);
    });

    it("never shows another chain's read", async () => {
      const polygon = fakeSource(healthyChain(POLYGON), POLYGON);
      const ethereum = fakeSource(healthyChain(ETHEREUM), ETHEREUM);
      const { result, rerender } = setup(input(polygon, { owner: ALICE }));
      await flush();
      expect(result.current.state?.chainId).toBe(137);

      ethereum.hold();
      rerender(input(ethereum, { owner: ALICE, deployment: ETHEREUM }));
      expect(result.current.state).toBeUndefined();
      expect(result.current.isVerifying).toBe(true);
      await flush();
      expect(ethereum.aggregate3).toHaveBeenCalledTimes(1);

      ethereum.release();
      await flush();
      expect(result.current.state?.chainId).toBe(1);
      expect(polygon.aggregate3).toHaveBeenCalledTimes(1);
    });
  });

  describe("refresh", () => {
    it("re-reads every VAULT_REFRESH_MS", async () => {
      const chain = healthyChain();
      const source = fakeSource(chain);
      const { result } = setup(input(source, { owner: ALICE }));
      await flush();

      chain.blockNumber = 1_010n;
      jest.setSystemTime(NOW + 5);
      await advance(VAULT_REFRESH_MS - 1);
      expect(source.aggregate3).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(source.aggregate3).toHaveBeenCalledTimes(2);
      expect(result.current.state?.blockNumber).toBe(1_010n);
      expect(result.current.updatedAt).toBe(NOW + 5 + VAULT_REFRESH_MS);
      await advance(VAULT_REFRESH_MS);
      expect(source.aggregate3).toHaveBeenCalledTimes(3);
    });

    it("pauses while the tab is hidden and reads again when it returns", async () => {
      const source = fakeSource(healthyChain());
      setup(input(source, { owner: ALICE }));
      await flush();

      act(() => focusManager.setFocused(false));
      await advance(VAULT_REFRESH_MS * 3);
      expect(source.aggregate3).toHaveBeenCalledTimes(1);

      act(() => focusManager.setFocused(true));
      await flush();
      expect(source.aggregate3).toHaveBeenCalledTimes(2);
    });

    it("reads again when the window regains focus from a wallet popup", async () => {
      const source = fakeSource(healthyChain());
      setup(input(source, { owner: ALICE }));
      await flush();

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await flush();
      expect(source.aggregate3).toHaveBeenCalledTimes(2);
    });
  });

  describe("refetch", () => {
    async function refetchNow(refetch: () => Promise<SettleObservation>, waitMs = 0) {
      let observation: SettleObservation | undefined;
      await act(async () => {
        const pending = refetch();
        await jest.advanceTimersByTimeAsync(waitMs);
        observation = await pending;
      });
      return observation;
    }

    it.each([
      { direction: "usdcToEusd" as SwapDirection, allowanceIn: 44n },
      { direction: "eusdToUsdc" as SwapDirection, allowanceIn: 33n },
    ])("resolves with the $direction input token's allowance and the read's block", async ({ direction, allowanceIn }) => {
      const chain = healthyChain();
      const source = fakeSource(chain);
      const { result } = setup(input(source, { owner: ALICE, direction }));
      await flush();

      chain.blockNumber = 1_234n;
      const observation = await refetchNow(result.current.refetch);

      expect(source.aggregate3).toHaveBeenCalledTimes(2);
      expect(observation).toEqual({ allowanceIn, blockNumber: 1_234n });
    });

    it("resolves with only the block for a disconnected read", async () => {
      const source = fakeSource(healthyChain());
      const { result } = setup(input(source));
      await flush();

      expect(await refetchNow(result.current.refetch)).toEqual({ allowanceIn: undefined, blockNumber: 1_000n });
    });

    it("joins a read already in flight instead of sending another", async () => {
      const source = fakeSource(healthyChain());
      source.hold();
      const { result } = setup(input(source, { owner: ALICE }));
      await flush();

      let observation: SettleObservation | undefined;
      await act(async () => {
        const pending = result.current.refetch();
        source.release();
        observation = await pending;
      });

      expect(source.aggregate3).toHaveBeenCalledTimes(1);
      expect(observation).toEqual({ allowanceIn: 44n, blockNumber: 1_000n });
    });

    it("resolves with nothing when the read fails", async () => {
      const source = fakeSource(healthyChain());
      const { result } = setup(input(source, { owner: ALICE }));
      await flush();

      source.failWith(new Error("down"));
      expect(await refetchNow(result.current.refetch)).toEqual({});
      expect(source.aggregate3).toHaveBeenCalledTimes(2);
    });

    it("resolves with nothing when the read is not verified", async () => {
      const chain = healthyChain();
      chain.stable = OTHER;
      const source = fakeSource(chain);
      const { result } = setup(input(source, { owner: ALICE }));
      await flush();

      expect(await refetchNow(result.current.refetch)).toEqual({});
    });
  });
});
