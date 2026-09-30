/** @jest-environment node */
import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, isAddressEqual, type Address, type Hex } from "viem";
import { erc20Abi, multicall3Abi, vaultAbi } from "./abis";
import { VAULT_DEPLOYMENTS, routeFor } from "./deployments";
import { AppError, ProvidersDisagreeError, QuoteUnavailableError, VaultIdentityError, VaultStateChangedError } from "./errors";
import {
  DISAGREE_RETRY_DELAY_MS,
  PREFLIGHT_TIMEOUT_MS,
  assertSimulatedOutput,
  assertVaultPreflight,
  pickCommonBlock,
  runVaultPreflight,
  withTimeout,
} from "./preflight";
import { buildSnapshotCalls } from "./reads";
import { TEST_WALLET } from "./testing/receipts";
import type {
  ApproveRequest,
  ChainSource,
  Multicall3Call,
  Multicall3Result,
  SimulateSwapParams,
  SwapDirection,
  SwapQuote,
  SwapRequest,
  VaultRequest,
  VaultSnapshot,
} from "./types";

const d = VAULT_DEPLOYMENTS[137];
const OWNER = TEST_WALLET;
const AMOUNT = 250_000000n;
const QUOTE: SwapQuote = Object.freeze({ amountOut: 249_750000n, fee: 250000n });
const RESERVE = 1_000_000_000000n;
const RPC_HEAD = 1_000n;
const WALLET_HEAD = 998n;
const WAD_PER_UNIT = 10n ** 12n;

function snapshot(overrides: Partial<VaultSnapshot> = {}): VaultSnapshot {
  return {
    chainId: 137,
    blockNumber: WALLET_HEAD,
    stable: d.stable,
    gem: d.gem,
    vaultPaused: false,
    stablePaused: false,
    stableReserve: RESERVE,
    gemReserve: RESERVE,
    maxPerTransaction: 0n,
    maxPerBlock: 0n,
    quote: QUOTE,
    balanceIn: AMOUNT,
    allowanceIn: AMOUNT,
    ...overrides,
  };
}

function swap(overrides: Partial<Omit<SwapRequest, "kind">> = {}): SwapRequest {
  return { kind: "swap", direction: "usdcToEusd", amountIn: AMOUNT, quote: QUOTE, ...overrides };
}

function approve(overrides: Partial<Omit<ApproveRequest, "kind">> = {}): ApproveRequest {
  return { kind: "approve", direction: "usdcToEusd", amountIn: AMOUNT, ...overrides };
}

type Checked = Readonly<{
  request?: VaultRequest;
  rpc?: Partial<VaultSnapshot>;
  wallet?: Partial<VaultSnapshot>;
  both?: Partial<VaultSnapshot>;
  pinnedBlock?: bigint;
}>;

function check(c: Checked = {}): void {
  assertVaultPreflight({
    request: c.request ?? swap(),
    deployment: d,
    rpc: snapshot({ ...c.both, ...c.rpc }),
    wallet: snapshot({ ...c.both, ...c.wallet }),
    pinnedBlock: c.pinnedBlock,
  });
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

function expectChange(error: unknown, change: string, retryable: boolean): void {
  expect(error).toBeInstanceOf(VaultStateChangedError);
  expect((error as VaultStateChangedError).change).toBe(change);
  expect((error as VaultStateChangedError).retryable).toBe(retryable);
}

// Answers each sub-call from a snapshot by its target and selector, so the real `decodeSnapshot` runs on real ABI data.
function answer(call: Multicall3Call, s: VaultSnapshot): Multicall3Result {
  const ok = (returnData: Hex): Multicall3Result => ({ success: true, returnData });
  if (isAddressEqual(call.target, d.multicall3)) {
    const { functionName } = decodeFunctionData({ abi: multicall3Abi, data: call.callData });
    if (functionName === "getChainId") return ok(encodeFunctionResult({ abi: multicall3Abi, functionName, result: BigInt(s.chainId) }));
    if (functionName === "getBlockNumber") return ok(encodeFunctionResult({ abi: multicall3Abi, functionName, result: s.blockNumber }));
  } else if (isAddressEqual(call.target, d.vault)) {
    const { functionName } = decodeFunctionData({ abi: vaultAbi, data: call.callData });
    switch (functionName) {
      case "STABLE":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.stable }));
      case "GEM":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.gem }));
      case "paused":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.vaultPaused }));
      case "getReserves":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: [s.stableReserve, s.gemReserve] }));
      case "maxPerTransaction":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.maxPerTransaction }));
      case "maxPerBlock":
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: s.maxPerBlock }));
      case "previewSellGem":
      case "previewBuyGem":
        if (s.quote === undefined) return { success: false, returnData: "0x" };
        return ok(encodeFunctionResult({ abi: vaultAbi, functionName, result: [s.quote.amountOut, s.quote.fee] }));
    }
  } else {
    const { functionName } = decodeFunctionData({ abi: erc20Abi, data: call.callData });
    switch (functionName) {
      case "paused":
        return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: s.stablePaused }));
      case "balanceOf":
        return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: s.balanceIn }));
      case "allowance":
        return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: s.allowanceIn }));
    }
  }
  throw new Error(`unexpected sub-call to ${call.target}`);
}

type Read = Readonly<{ index: number; blockNumber?: bigint }>;

type FakeOptions = Readonly<{
  heads?: readonly bigint[];
  /** The snapshot for the nth `aggregate3`. Defaults to `snapshot()` at the requested block, or the head. */
  state?: (read: Read) => VaultSnapshot;
  simulate?: (p: SimulateSwapParams) => Promise<bigint>;
  /** Runs when a request is sent, before it answers; may return a promise the request waits for. */
  before?: (method: string) => Promise<void> | void;
}>;

type FakeSource = ChainSource &
  Readonly<{
    requests: string[];
    reads: Array<Readonly<{ calls: readonly Multicall3Call[]; args: number; blockNumber?: bigint }>>;
    simulations: SimulateSwapParams[];
  }>;

function fakeSource(o: FakeOptions = {}): FakeSource {
  const heads = o.heads ?? [RPC_HEAD];
  const requests: string[] = [];
  const reads: Array<Readonly<{ calls: readonly Multicall3Call[]; args: number; blockNumber?: bigint }>> = [];
  const simulations: SimulateSwapParams[] = [];
  let headIndex = 0;
  const sent = async (method: string) => {
    requests.push(method);
    await o.before?.(method);
  };
  return {
    requests,
    reads,
    simulations,
    async getBlockNumber() {
      await sent("getBlockNumber");
      const head = heads[Math.min(headIndex, heads.length - 1)];
      headIndex += 1;
      return head;
    },
    async aggregate3(...args: [Address, readonly Multicall3Call[], bigint?]) {
      const [multicall3, calls, blockNumber] = args;
      expect(multicall3).toBe(d.multicall3);
      const index = reads.length;
      reads.push({ calls, args: args.length, blockNumber });
      await sent("aggregate3");
      const s = o.state?.({ index, blockNumber }) ?? snapshot({ blockNumber: blockNumber ?? heads[0] });
      return calls.map((call) => answer(call, s));
    },
    async simulateSwap(p) {
      simulations.push(p);
      await sent("simulateSwap");
      return o.simulate ? o.simulate(p) : QUOTE.amountOut;
    },
    async getCode() {
      await sent("getCode");
      return undefined;
    },
  };
}

/** Answers every read at the requested block (or `blockNumber`), with `overrides` for the nth read. */
function states(...perRead: ReadonlyArray<Partial<VaultSnapshot>>): (read: Read) => VaultSnapshot {
  return ({ index, blockNumber }) =>
    snapshot({ blockNumber: blockNumber ?? RPC_HEAD, ...perRead[Math.min(index, perRead.length - 1)] });
}

type Clock = Readonly<{
  sleep: jest.Mock<Promise<void>, [number, AbortSignal?]>;
  /** Signals passed to hanging sleeps. */
  signals: AbortSignal[];
  /** Resolves every hanging sleep, as if its time had passed. */
  elapse(): void;
}>;

/** Resolves at once, except sleeps for which `hang(ms)` holds; those wait for `elapse()` or their signal. */
function fakeClock(hang: (ms: number) => boolean = (ms) => ms === PREFLIGHT_TIMEOUT_MS): Clock {
  const waiting: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  const sleep = jest.fn((ms: number, signal?: AbortSignal) => {
    if (!hang(ms)) return Promise.resolve();
    if (signal) signals.push(signal);
    return new Promise<void>((resolve) => {
      waiting.push(resolve);
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  });
  return { sleep, signals, elapse: () => waiting.splice(0).forEach((resolve) => resolve()) };
}

function retryDelays(clock: Clock): number[] {
  return clock.sleep.mock.calls.map(([ms]) => ms).filter((ms) => ms !== PREFLIGHT_TIMEOUT_MS);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

type Run = Readonly<{
  request?: VaultRequest;
  rpc?: FakeSource;
  wallet?: FakeSource;
  clock?: Clock;
  controller?: AbortController;
  retryDelayMs?: number;
  timeoutMs?: number;
}>;

function run(r: Run = {}) {
  const rpc = r.rpc ?? fakeSource({ heads: [RPC_HEAD] });
  const wallet = r.wallet ?? fakeSource({ heads: [WALLET_HEAD] });
  const clock = r.clock ?? fakeClock();
  const controller = r.controller ?? new AbortController();
  const promise = runVaultPreflight(r.request ?? swap(), d, OWNER, { rpc, wallet }, {
    sleep: clock.sleep,
    signal: controller.signal,
    retryDelayMs: r.retryDelayMs,
    timeoutMs: r.timeoutMs,
  });
  return { promise, rpc, wallet, clock, controller };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error
  );
}

function expectAbortError(error: unknown): void {
  expect(error).toBeInstanceOf(DOMException);
  expect((error as DOMException).name).toBe("AbortError");
}

const revert = (errorName: "EnforcedPause" | "InsufficientReserves") =>
  Object.assign(new Error("execution reverted"), { code: 3, data: encodeErrorResult({ abi: vaultAbi, errorName }) });

describe("pickCommonBlock", () => {
  it("returns the lower block number", () => {
    expect(pickCommonBlock(10n, 12n)).toBe(10n);
    expect(pickCommonBlock(12n, 10n)).toBe(10n);
    expect(pickCommonBlock(7n, 7n)).toBe(7n);
  });
});

describe("assertVaultPreflight", () => {
  it.each<SwapDirection>(["usdcToEusd", "eusdToUsdc"])("accepts matching swap snapshots (%s)", (direction) => {
    expect(() => check({ request: swap({ direction }) })).not.toThrow();
  });

  it("accepts matching approval snapshots", () => {
    expect(() => check({ request: approve() })).not.toThrow();
  });

  it("accepts a balance above the amount, and one equal to it", () => {
    expect(() => check({ both: { balanceIn: AMOUNT + 1n } })).not.toThrow();
    expect(() => check({ both: { balanceIn: AMOUNT } })).not.toThrow();
  });

  describe("step 0", () => {
    it.each([0n, -1n])("rejects an amount of %s as zero output, not retryable", (amountIn) => {
      expectChange(caught(() => check({ request: swap({ amountIn }) })), "zero-output", false);
      expectChange(caught(() => check({ request: approve({ amountIn }) })), "zero-output", false);
    });

    it("rejects a swap whose shown quote pays nothing", () => {
      expectChange(caught(() => check({ request: swap({ quote: { amountOut: 0n, fee: 0n } }) })), "zero-output", false);
    });

    it("runs before any snapshot check", () => {
      const error = caught(() => check({ request: swap({ amountIn: 0n }), rpc: { chainId: 1 }, wallet: { vaultPaused: true } }));
      expectChange(error, "zero-output", false);
    });
  });

  describe("step 1: identity, pinned block and pause on each provider", () => {
    it.each(["rpc", "wallet"] as const)("rejects the %s provider on the wrong network", (side) => {
      const error = caught(() => check({ [side]: { chainId: 1 } }));
      expect(error).toBeInstanceOf(VaultIdentityError);
      expect((error as Error).message).toBe("Security verification failed: the network does not match the vault's network");
    });

    it.each([
      ["rpc", "stable"],
      ["rpc", "gem"],
      ["wallet", "stable"],
      ["wallet", "gem"],
    ] as const)("rejects a %s provider whose vault reports another %s token", (side, field) => {
      const error = caught(() => check({ [side]: { [field]: "0x4444444444444444444444444444444444444444" } }));
      expect(error).toBeInstanceOf(VaultIdentityError);
      expect((error as Error).message).toBe("Security verification failed: vault contract identity mismatch");
    });

    it("compares token addresses without regard to case", () => {
      const lower = { stable: d.stable.toLowerCase() as Address, gem: d.gem.toLowerCase() as Address };
      expect(() => check({ rpc: lower, wallet: lower })).not.toThrow();
    });

    it.each(["rpc", "wallet"] as const)("reports a %s snapshot from another block than the pinned one as a disagreement", (side) => {
      expect(() => check({ both: { blockNumber: 50n }, [side]: { blockNumber: 51n }, pinnedBlock: 50n })).toThrow(
        ProvidersDisagreeError
      );
    });

    it("skips the block check when nothing was pinned", () => {
      expect(() => check({ rpc: { blockNumber: 50n }, wallet: { blockNumber: 51n } })).not.toThrow();
    });

    it.each([
      ["rpc", "vaultPaused"],
      ["wallet", "vaultPaused"],
      ["rpc", "stablePaused"],
      ["wallet", "stablePaused"],
    ] as const)("rejects a %s snapshot with %s as paused, not retryable", (side, field) => {
      const error = caught(() => check({ [side]: { [field]: true } }));
      expectChange(error, "paused", false);
      expect((error as Error).message).toBe("Swaps are currently paused. Please check back later.");
    });

    it("rejects a paused eUSD for an approval too", () => {
      expectChange(caught(() => check({ request: approve(), both: { stablePaused: true } })), "paused", false);
    });

    it("checks the RPC in full before the wallet", () => {
      expectChange(caught(() => check({ rpc: { vaultPaused: true }, wallet: { chainId: 1 } })), "paused", false);
      expect(() => check({ rpc: { blockNumber: 7n }, wallet: { chainId: 1 }, pinnedBlock: 6n })).toThrow(ProvidersDisagreeError);
    });

    it("checks identity before the pinned block and the pause", () => {
      expect(() => check({ rpc: { chainId: 1, blockNumber: 7n, vaultPaused: true }, pinnedBlock: 6n })).toThrow(VaultIdentityError);
    });
  });

  describe("step 2: agreement", () => {
    it.each<[string, Partial<VaultSnapshot>]>([
      ["balance", { balanceIn: AMOUNT + 1n }],
      ["allowance", { allowanceIn: AMOUNT + 1n }],
      ["eUSD reserve", { stableReserve: RESERVE - 1n }],
      ["USDC reserve", { gemReserve: RESERVE - 1n }],
      ["per-transaction cap", { maxPerTransaction: 1n }],
      ["per-block cap", { maxPerBlock: 1n }],
      ["quoted output", { quote: { amountOut: QUOTE.amountOut - 1n, fee: QUOTE.fee } }],
      ["quoted fee", { quote: { amountOut: QUOTE.amountOut, fee: QUOTE.fee + 1n } }],
      ["quote presence", { quote: undefined }],
    ])("reports a different %s as a provider disagreement", (_label, wallet) => {
      expect(() => check({ wallet })).toThrow(ProvidersDisagreeError);
    });

    it("checks disagreement before change", () => {
      expect(() => check({ rpc: { balanceIn: 150n }, wallet: { balanceIn: 149n } })).toThrow(ProvidersDisagreeError);
    });

    it("checks identity and pause before agreement", () => {
      expect(() => check({ wallet: { chainId: 1, balanceIn: 1n } })).toThrow(VaultIdentityError);
      expectChange(caught(() => check({ wallet: { stablePaused: true, balanceIn: 1n } })), "paused", false);
    });

    it("ignores the allowance for an approval", () => {
      expect(() => check({ request: approve(), rpc: { allowanceIn: 1n }, wallet: { allowanceIn: 2n } })).not.toThrow();
    });
  });

  describe("step 3: preview", () => {
    it.each([swap(), approve()])("reports a failed preview on both providers as no quote ($kind)", (request) => {
      expect(() => check({ request, both: { quote: undefined } })).toThrow(QuoteUnavailableError);
    });
  });

  describe("steps 4 to 6", () => {
    it("reports an agreed balance below the amount as changed", () => {
      const error = caught(() => check({ both: { balanceIn: AMOUNT - 1n } }));
      expectChange(error, "balance", true);
      expect(error).not.toBeInstanceOf(ProvidersDisagreeError);
      expect((error as AppError).tone).toBe("warning");
    });

    it("sends an allowance below the amount back to Step 1", () => {
      const error = caught(() => check({ both: { allowanceIn: AMOUNT - 1n } }));
      expectChange(error, "allowance", true);
      expect((error as Error).message).toBe("Your approval no longer covers this amount. Start again from Step 1.");
    });

    it("accepts an allowance above the amount", () => {
      expect(() => check({ both: { allowanceIn: AMOUNT * 2n } })).not.toThrow();
    });

    it("ignores the allowance threshold for an approval", () => {
      expect(() => check({ request: approve(), both: { allowanceIn: 0n } })).not.toThrow();
    });

    it.each<[string, SwapQuote]>([
      ["output", { amountOut: QUOTE.amountOut - 1n, fee: QUOTE.fee + 1n }],
      ["fee", { amountOut: QUOTE.amountOut, fee: QUOTE.fee + 1n }],
    ])("reports an agreed preview whose %s differs from the shown quote as a quote change", (_label, quote) => {
      expectChange(caught(() => check({ both: { quote } })), "quote", true);
    });

    it("does not compare an approval's preview with a shown quote", () => {
      expect(() => check({ request: approve(), both: { quote: { amountOut: 1n, fee: 0n } } })).not.toThrow();
    });

    it("checks balance, then allowance, then quote", () => {
      const quote = { amountOut: 1n, fee: 0n };
      expectChange(caught(() => check({ both: { balanceIn: 0n, allowanceIn: 0n, quote } })), "balance", true);
      expectChange(caught(() => check({ both: { allowanceIn: 0n, quote } })), "allowance", true);
    });
  });

  describe("steps 7 to 10", () => {
    it("reports a preview that pays nothing as zero output", () => {
      expectChange(caught(() => check({ request: approve(), both: { quote: { amountOut: 0n, fee: 1n } } })), "zero-output", true);
    });

    it("treats a cap of 0 as off", () => {
      const amountIn = 10n ** 15n;
      const quote = { amountOut: amountIn, fee: 0n };
      const both = { balanceIn: amountIn, allowanceIn: amountIn, stableReserve: amountIn, quote };
      expect(() => check({ request: swap({ amountIn, quote }), both: { ...both, maxPerTransaction: 0n, maxPerBlock: 0n } })).not.toThrow();
    });

    it.each([
      ["maxPerTransaction", "per-transaction"],
      ["maxPerBlock", "per-block"],
    ] as const)("allows an amount equal to %s in WAD and rejects one WAD above it", (field, change) => {
      const cap = AMOUNT * WAD_PER_UNIT;
      expect(() => check({ both: { [field]: cap } })).not.toThrow();
      expectChange(caught(() => check({ both: { [field]: cap - 1n } })), change, true);
    });

    it("rejects an amount one unit above a cap", () => {
      const amountIn = AMOUNT + 1n;
      const both = { balanceIn: amountIn, allowanceIn: amountIn, maxPerTransaction: AMOUNT * WAD_PER_UNIT };
      expectChange(caught(() => check({ request: swap({ amountIn }), both })), "per-transaction", true);
    });

    it("checks the per-transaction cap before the per-block cap, and both before the reserve", () => {
      const both = { maxPerTransaction: 1n, maxPerBlock: 1n, stableReserve: 0n };
      expectChange(caught(() => check({ both })), "per-transaction", true);
      expectChange(caught(() => check({ both: { ...both, maxPerTransaction: 0n } })), "per-block", true);
    });

    it("requires the output reserve to cover the output plus the fee", () => {
      const needed = QUOTE.amountOut + QUOTE.fee;
      expect(() => check({ both: { stableReserve: needed } })).not.toThrow();
      expectChange(caught(() => check({ both: { stableReserve: needed - 1n } })), "reserves", true);
    });

    it.each<[SwapDirection, "stableReserve" | "gemReserve", "stableReserve" | "gemReserve"]>([
      ["usdcToEusd", "stableReserve", "gemReserve"],
      ["eusdToUsdc", "gemReserve", "stableReserve"],
    ])("checks %s against %s only", (direction, output, input) => {
      expect(routeFor(d, direction).outputReserve).toBe(output);
      const needed = QUOTE.amountOut + QUOTE.fee;
      for (const request of [swap({ direction }), approve({ direction })]) {
        expect(() => check({ request, both: { [output]: needed, [input]: 0n } })).not.toThrow();
        expectChange(caught(() => check({ request, both: { [output]: needed - 1n, [input]: RESERVE } })), "reserves", true);
      }
    });
  });
});

describe("assertSimulatedOutput", () => {
  it("accepts the shown output", () => {
    expect(() => assertSimulatedOutput(QUOTE.amountOut, QUOTE)).not.toThrow();
  });

  it.each([QUOTE.amountOut - 1n, QUOTE.amountOut + 1n])("rejects %s as a quote change naming both amounts", (simulated) => {
    const error = caught(() => assertSimulatedOutput(simulated, { amountOut: 1_234_500000n, fee: 0n }));
    expectChange(error, "quote", false);
    expect((error as Error).message).toMatch(/^The vault's quote changed from 1,234\.5 to /);
  });

  it("formats both amounts with the vault's decimals", () => {
    const error = caught(() => assertSimulatedOutput(1_234_000001n, { amountOut: 1_234_500000n, fee: 0n }));
    expect((error as Error).message).toBe(
      "The vault's quote changed from 1,234.5 to 1,234.000001. Review the new amount and confirm again."
    );
  });
});

describe("withTimeout", () => {
  it("resolves with the work's value and releases the timer", async () => {
    const clock = fakeClock((ms) => ms === 5_000);
    await expect(withTimeout(Promise.resolve(7), 5_000, { sleep: clock.sleep, signal: new AbortController().signal })).resolves.toBe(7);
    expect(clock.sleep).toHaveBeenCalledWith(5_000, expect.any(AbortSignal));
    expect(clock.signals[0]?.aborted).toBe(true);
  });

  it("rejects with the work's own error", async () => {
    const failure = new Error("boom");
    const clock = fakeClock((ms) => ms === 5_000);
    await expect(withTimeout(Promise.reject(failure), 5_000, { sleep: clock.sleep, signal: new AbortController().signal })).rejects.toBe(
      failure
    );
  });

  it("rejects with a warning when the time runs out, and ignores a late answer", async () => {
    const clock = fakeClock((ms) => ms === 5_000);
    let answer: (value: number) => void = () => undefined;
    const work = new Promise<number>((resolve) => {
      answer = resolve;
    });
    const raced = withTimeout(work, 5_000, { sleep: clock.sleep, signal: new AbortController().signal });
    clock.elapse();
    const error = await rejection(raced);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe("Your wallet or the network did not answer in time. Try again.");
    expect((error as AppError).tone).toBe("warning");
    answer(1);
    await flush();
  });

  it("rejects with an AbortError when the signal aborts, and releases the timer", async () => {
    const clock = fakeClock((ms) => ms === 5_000);
    const controller = new AbortController();
    const raced = withTimeout(new Promise<never>(() => undefined), 5_000, { sleep: clock.sleep, signal: controller.signal });
    controller.abort();
    expectAbortError(await rejection(raced));
    expect(clock.signals[0]?.aborted).toBe(true);
  });

  it("rejects at once without starting the timer when the signal has already aborted", async () => {
    const clock = fakeClock((ms) => ms === 5_000);
    const controller = new AbortController();
    controller.abort();
    expectAbortError(await rejection(withTimeout(Promise.resolve(1), 5_000, { sleep: clock.sleep, signal: controller.signal })));
    expect(clock.sleep).not.toHaveBeenCalled();
  });
});

describe("runVaultPreflight", () => {
  it.each<SwapDirection>(["usdcToEusd", "eusdToUsdc"])(
    "reads each provider twice at the lower head, then simulates once on each (%s)",
    async (direction) => {
      const request = swap({ direction });
      const { promise, rpc, wallet, clock } = run({ request });
      await expect(promise).resolves.toBeUndefined();

      for (const source of [rpc, wallet]) {
        expect(source.requests).toEqual(["getBlockNumber", "aggregate3", "simulateSwap"]);
        expect(source.reads).toEqual([
          { calls: buildSnapshotCalls(d, routeFor(d, direction), OWNER, AMOUNT), args: 3, blockNumber: WALLET_HEAD },
        ]);
        expect(source.simulations).toEqual([
          { vault: d.vault, functionName: routeFor(d, direction).swapFunction, account: OWNER, recipient: OWNER, amountIn: AMOUNT },
        ]);
      }
      expect(retryDelays(clock)).toEqual([]);
      expect(clock.sleep).toHaveBeenCalledWith(PREFLIGHT_TIMEOUT_MS, expect.any(AbortSignal));
    }
  );

  it("never simulates an approval and ignores its allowance", async () => {
    const rpc = fakeSource({ heads: [RPC_HEAD], state: states({ allowanceIn: 0n }) });
    const wallet = fakeSource({ heads: [WALLET_HEAD], state: states({ allowanceIn: 5n }) });
    await expect(run({ request: approve(), rpc, wallet }).promise).resolves.toBeUndefined();
    expect(rpc.requests).toEqual(["getBlockNumber", "aggregate3"]);
    expect(wallet.requests).toEqual(["getBlockNumber", "aggregate3"]);
  });

  it("retries a disagreement once, pinned at fresh heads, after the default delay", async () => {
    const rpc = fakeSource({ heads: [RPC_HEAD, RPC_HEAD + 2n] });
    const wallet = fakeSource({ heads: [WALLET_HEAD, RPC_HEAD + 3n], state: states({ balanceIn: AMOUNT + 1n }, {}) });
    const { promise, clock } = run({ rpc, wallet });
    await expect(promise).resolves.toBeUndefined();

    expect(retryDelays(clock)).toEqual([DISAGREE_RETRY_DELAY_MS]);
    for (const source of [rpc, wallet]) {
      expect(source.requests).toEqual(["getBlockNumber", "aggregate3", "getBlockNumber", "aggregate3", "simulateSwap"]);
      expect(source.reads.map((r) => r.blockNumber)).toEqual([WALLET_HEAD, RPC_HEAD + 2n]);
    }
  });

  it("retries a snapshot from another block than B, pinned", async () => {
    const wallet = fakeSource({
      heads: [WALLET_HEAD],
      state: ({ index, blockNumber }) => snapshot({ blockNumber: index === 0 ? (blockNumber ?? 0n) + 1n : blockNumber }),
    });
    const { promise, rpc } = run({ wallet });
    await expect(promise).resolves.toBeUndefined();
    expect(rpc.requests).toEqual(["getBlockNumber", "aggregate3", "getBlockNumber", "aggregate3", "simulateSwap"]);
  });

  it("uses the given retry delay", async () => {
    const wallet = fakeSource({ heads: [WALLET_HEAD], state: states({ gemReserve: 1n }, {}) });
    const { promise, clock } = run({ wallet, retryDelayMs: 42 });
    await expect(promise).resolves.toBeUndefined();
    expect(retryDelays(clock)).toEqual([42]);
  });

  it("retries a retryable state change once, unpinned at each provider's latest", async () => {
    const rpc = fakeSource({ heads: [RPC_HEAD], state: states({ balanceIn: AMOUNT - 1n }, {}) });
    const wallet = fakeSource({ heads: [WALLET_HEAD], state: states({ balanceIn: AMOUNT - 1n }, {}) });
    const { promise, clock } = run({ rpc, wallet });
    await expect(promise).resolves.toBeUndefined();

    expect(retryDelays(clock)).toEqual([DISAGREE_RETRY_DELAY_MS]);
    for (const source of [rpc, wallet]) {
      expect(source.requests).toEqual(["getBlockNumber", "aggregate3", "aggregate3", "simulateSwap"]);
      expect(source.reads.map((r) => [r.args, r.blockNumber])).toEqual([
        [3, WALLET_HEAD],
        [2, undefined],
      ]);
    }
  });

  it("does not require an unpinned retry's providers to answer at the same block", async () => {
    const stale = { amountOut: QUOTE.amountOut - 1n, fee: QUOTE.fee };
    const at = (latest: bigint) => (read: Read) =>
      read.index === 0 ? snapshot({ blockNumber: read.blockNumber, quote: stale }) : snapshot({ blockNumber: latest });
    const rpc = fakeSource({ heads: [RPC_HEAD], state: at(RPC_HEAD + 5n) });
    const wallet = fakeSource({ heads: [WALLET_HEAD], state: at(WALLET_HEAD + 1n) });
    await expect(run({ rpc, wallet }).promise).resolves.toBeUndefined();
    expect(rpc.requests).toEqual(["getBlockNumber", "aggregate3", "aggregate3", "simulateSwap"]);
  });

  it.each<[string, Partial<VaultSnapshot>, (error: unknown) => void]>([
    ["a wrong network", { chainId: 1 }, (error) => expect(error).toBeInstanceOf(VaultIdentityError)],
    ["another token", { gem: "0x4444444444444444444444444444444444444444" }, (error) => expect(error).toBeInstanceOf(VaultIdentityError)],
    ["a paused vault", { vaultPaused: true }, (error) => expectChange(error, "paused", false)],
    ["a paused eUSD", { stablePaused: true }, (error) => expectChange(error, "paused", false)],
    ["a failed preview", { quote: undefined }, (error) => expect(error).toBeInstanceOf(QuoteUnavailableError)],
  ])("fails at once on %s, without a retry or a simulation", async (_label, overrides, expectError) => {
    const rpc = fakeSource({ heads: [RPC_HEAD], state: states(overrides) });
    const wallet = fakeSource({ heads: [WALLET_HEAD], state: states(overrides) });
    const { promise, clock } = run({ rpc, wallet });
    expectError(await rejection(promise));
    expect(retryDelays(clock)).toEqual([]);
    expect(rpc.requests).toEqual(["getBlockNumber", "aggregate3"]);
    expect(wallet.requests).toEqual(["getBlockNumber", "aggregate3"]);
  });

  it("fails at once on a zero amount", async () => {
    const { promise, rpc, clock } = run({ request: swap({ amountIn: 0n }) });
    expectChange(await rejection(promise), "zero-output", false);
    expect(retryDelays(clock)).toEqual([]);
    expect(rpc.requests).toEqual(["getBlockNumber", "aggregate3"]);
  });

  it("fails at once when a required sub-call failed", async () => {
    const rpc = fakeSource({ heads: [RPC_HEAD] });
    const failed: Multicall3Result = { success: false, returnData: "0x" };
    const broken: FakeSource = {
      ...rpc,
      aggregate3: async (m, calls, b) => (await rpc.aggregate3(m, calls, b)).map((r, i) => (i === 0 ? failed : r)),
    };
    const { promise, clock } = run({ rpc: broken });
    const error = await rejection(promise);
    expect(error).toBeInstanceOf(AppError);
    expect((error as Error).message).toBe("The vault's state could not be read. Try again shortly.");
    expect(retryDelays(clock)).toEqual([]);
  });

  it.each(["getBlockNumber", "aggregate3"])("passes a failed %s through unchanged, without a retry", async (method) => {
    const failure = new Error("HTTP request failed");
    const wallet = fakeSource({
      heads: [WALLET_HEAD],
      before: (m) => {
        if (m === method) throw failure;
      },
    });
    const { promise, clock } = run({ wallet });
    expect(await rejection(promise)).toBe(failure);
    expect(retryDelays(clock)).toEqual([]);
  });

  it("surfaces the second failure when the retry fails too", async () => {
    const rpc = fakeSource({ heads: [RPC_HEAD, RPC_HEAD + 1n], state: states({}, { balanceIn: AMOUNT - 1n }) });
    const wallet = fakeSource({ heads: [WALLET_HEAD, RPC_HEAD + 1n], state: states({ balanceIn: AMOUNT - 5n }, { balanceIn: AMOUNT - 1n }) });
    const { promise, clock } = run({ rpc, wallet });
    expectChange(await rejection(promise), "balance", true);
    expect(retryDelays(clock)).toEqual([DISAGREE_RETRY_DELAY_MS]);
    expect(rpc.requests).toEqual(["getBlockNumber", "aggregate3", "getBlockNumber", "aggregate3"]);
  });

  it("retries at most once", async () => {
    const wallet = fakeSource({ heads: [WALLET_HEAD], state: states({ balanceIn: 1n }) });
    const { promise, rpc, clock } = run({ wallet });
    expect(await rejection(promise)).toBeInstanceOf(ProvidersDisagreeError);
    expect(retryDelays(clock)).toEqual([DISAGREE_RETRY_DELAY_MS]);
    expect(rpc.requests).toEqual(["getBlockNumber", "aggregate3", "getBlockNumber", "aggregate3"]);
  });

  it.each(["rpc", "wallet"] as const)("rejects a %s simulation that pays another amount, without a retry", async (side) => {
    const odd = fakeSource({ heads: [side === "rpc" ? RPC_HEAD : WALLET_HEAD], simulate: async () => QUOTE.amountOut - 1n });
    const { promise, rpc, wallet, clock } = run(side === "rpc" ? { rpc: odd } : { wallet: odd });
    const error = await rejection(promise);
    expectChange(error, "quote", false);
    expect((error as Error).message).toBe("The vault's quote changed from 249.75 to 249.749999. Review the new amount and confirm again.");
    expect(retryDelays(clock)).toEqual([]);
    expect(rpc.simulations).toHaveLength(1);
    expect(wallet.simulations).toHaveLength(1);
  });

  it("maps a simulated EnforcedPause to paused", async () => {
    const wallet = fakeSource({ heads: [WALLET_HEAD], simulate: () => Promise.reject(revert("EnforcedPause")) });
    const { promise, clock } = run({ wallet });
    const error = await rejection(promise);
    expectChange(error, "paused", false);
    expect((error as Error).message).toBe("Swaps are currently paused. Please check back later.");
    expect(retryDelays(clock)).toEqual([]);
  });

  it("maps another recognised simulated revert to its state change", async () => {
    const rpc = fakeSource({ heads: [RPC_HEAD], simulate: () => Promise.reject(revert("InsufficientReserves")) });
    expectChange(await rejection(run({ rpc }).promise), "reserves", false);
  });

  it("rethrows an unrecognised simulation error unchanged", async () => {
    const failure = new Error("wallet provider exploded");
    const wallet = fakeSource({ heads: [WALLET_HEAD], simulate: () => Promise.reject(failure) });
    const { promise, rpc } = run({ wallet });
    expect(await rejection(promise)).toBe(failure);
    expect(rpc.simulations).toHaveLength(1);
  });

  it("does not simulate when the snapshot checks fail", async () => {
    const rpc = fakeSource({ heads: [RPC_HEAD], state: states({ vaultPaused: true }) });
    const { promise, wallet } = run({ rpc });
    await rejection(promise);
    expect(rpc.simulations).toEqual([]);
    expect(wallet.simulations).toEqual([]);
  });

  it("times out on a hung wallet and sends nothing after its late answer", async () => {
    let answer: () => void = () => undefined;
    const wallet = fakeSource({
      heads: [WALLET_HEAD],
      before: (method) =>
        method === "getBlockNumber"
          ? new Promise<void>((resolve) => {
              answer = resolve;
            })
          : undefined,
    });
    const { promise, rpc, clock } = run({ wallet, timeoutMs: 30_000, clock: fakeClock((ms) => ms === 30_000) });
    await flush();
    expect(clock.sleep).toHaveBeenCalledWith(30_000, expect.any(AbortSignal));
    clock.elapse();
    const error = await rejection(promise);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe("Your wallet or the network did not answer in time. Try again.");
    expect((error as AppError).tone).toBe("warning");

    answer();
    await flush();
    expect(rpc.requests).toEqual(["getBlockNumber"]);
    expect(wallet.requests).toEqual(["getBlockNumber"]);
  });

  it.each([
    ["getBlockNumber", ["getBlockNumber"]],
    ["aggregate3", ["getBlockNumber", "aggregate3"]],
    ["simulateSwap", ["getBlockNumber", "aggregate3", "simulateSwap"]],
  ])("stops without another request when aborted during %s", async (method, sent) => {
    const controller = new AbortController();
    const wallet = fakeSource({
      heads: [WALLET_HEAD],
      before: (m) => {
        if (m === method) controller.abort();
      },
    });
    const { promise, rpc } = run({ wallet, controller });
    expectAbortError(await rejection(promise));
    await flush();
    expect(rpc.requests).toEqual(sent);
    expect(wallet.requests).toEqual(sent);
  });

  it("stops without another attempt when aborted during the retry delay", async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    clock.sleep.mockImplementation((ms: number) => {
      if (ms === DISAGREE_RETRY_DELAY_MS) controller.abort();
      return ms === PREFLIGHT_TIMEOUT_MS ? new Promise<void>(() => undefined) : Promise.resolve();
    });
    const wallet = fakeSource({ heads: [WALLET_HEAD], state: states({ balanceIn: 1n }) });
    const { promise, rpc } = run({ wallet, controller, clock });
    expectAbortError(await rejection(promise));
    await flush();
    expect(rpc.requests).toEqual(["getBlockNumber", "aggregate3"]);
    expect(wallet.requests).toEqual(["getBlockNumber", "aggregate3"]);
  });

  it("sends nothing when the signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { promise, rpc, wallet } = run({ controller });
    expectAbortError(await rejection(promise));
    await flush();
    expect(rpc.requests).toEqual([]);
    expect(wallet.requests).toEqual([]);
  });
});
