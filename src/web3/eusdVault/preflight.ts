import { isAddressEqual, type Address } from "viem";
import { toWad } from "./amount";
import { VAULT_DECIMALS, routeFor } from "./deployments";
import { AppError, ProvidersDisagreeError, QuoteUnavailableError, VaultIdentityError, VaultStateChangedError } from "./errors";
import { formatAmount } from "./format";
import { abortError } from "./internal";
import { buildSnapshotCalls, decodeSnapshot } from "./reads";
import type { ChainSource, SwapQuote, VaultDeployment, VaultRequest, VaultSnapshot } from "./types";
import { decodeVaultRevert } from "./vaultErrors";

/** Wait between the two preflight attempts. */
export const DISAGREE_RETRY_DELAY_MS = 1_500;

/**
 * Upper bound on the whole preflight. A wallet's provider may never answer (WalletConnect settles a request only
 * when a reply with its id arrives), so without this the page could sit in "checking" with no way out. Well above
 * the app transport's own timeout, so it fires for a hang and not for a slow read.
 */
export const PREFLIGHT_TIMEOUT_MS = 60_000;

const TIMED_OUT = "Your wallet or the network did not answer in time. Try again.";
const ABOVE_BLOCK_LIMIT = "This amount is above the vault's per-block limit. Enter a smaller amount.";

type SleepDeps = Readonly<{ sleep(ms: number, signal?: AbortSignal): Promise<void>; signal: AbortSignal }>;

type Sources = Readonly<{ rpc: ChainSource; wallet: ChainSource }>;

/** The block both snapshots can be pinned to: the one every provider has. */
export function pickCommonBlock(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function quotesEqual(a: SwapQuote | undefined, b: SwapQuote | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.amountOut === b.amountOut && a.fee === b.fee;
}

function assertSource(s: VaultSnapshot, d: VaultDeployment, pinnedBlock: bigint | undefined): void {
  if (s.chainId !== d.chainId) throw new VaultIdentityError("chain");
  if (!isAddressEqual(s.stable, d.stable) || !isAddressEqual(s.gem, d.gem)) throw new VaultIdentityError("contracts");
  if (pinnedBlock !== undefined && s.blockNumber !== pinnedBlock) throw new ProvidersDisagreeError();
  if (s.vaultPaused || s.stablePaused) throw new VaultStateChangedError("paused");
}

function assertAgreement(a: VaultSnapshot, b: VaultSnapshot, checkAllowance: boolean): void {
  const agree =
    a.balanceIn === b.balanceIn &&
    (!checkAllowance || a.allowanceIn === b.allowanceIn) &&
    a.stableReserve === b.stableReserve &&
    a.gemReserve === b.gemReserve &&
    a.maxPerTransaction === b.maxPerTransaction &&
    a.maxPerBlock === b.maxPerBlock &&
    quotesEqual(a.quote, b.quote);
  if (!agree) throw new ProvidersDisagreeError();
}

/**
 * Appendix B's assertions, in order; the first failure throws. Identity, pinned block and pause are checked on each
 * source, then the two must agree, and only then is the shared state compared with the request. An approve skips
 * the allowance (it is the value being set, so the two providers may see it change at different moments) and the
 * quote-equals-shown check.
 */
export function assertVaultPreflight(
  i: Readonly<{ request: VaultRequest; deployment: VaultDeployment; rpc: VaultSnapshot; wallet: VaultSnapshot; pinnedBlock?: bigint }>
): void {
  const { request, deployment: d, rpc, wallet, pinnedBlock } = i;
  const swap = request.kind === "swap" ? request : undefined;

  if (request.amountIn <= 0n || (swap !== undefined && swap.quote.amountOut <= 0n)) {
    throw new VaultStateChangedError("zero-output", { retryable: false });
  }

  assertSource(rpc, d, pinnedBlock);
  assertSource(wallet, d, pinnedBlock);
  assertAgreement(rpc, wallet, swap !== undefined);

  const quote = rpc.quote;
  if (quote === undefined) throw new QuoteUnavailableError();

  if (rpc.balanceIn < request.amountIn) throw new VaultStateChangedError("balance");
  if (swap !== undefined) {
    if (rpc.allowanceIn < swap.amountIn) throw new VaultStateChangedError("allowance");
    if (!quotesEqual(quote, swap.quote)) throw new VaultStateChangedError("quote");
  }

  if (quote.amountOut <= 0n) throw new VaultStateChangedError("zero-output");
  // Caps are WAD on the input amount; 0 turns a cap off.
  const wad = toWad(request.amountIn, d.decimals);
  // An amount above the per-transaction cap never passes, so retrying cannot help.
  if (rpc.maxPerTransaction !== 0n && wad > rpc.maxPerTransaction) {
    throw new VaultStateChangedError("per-transaction", { retryable: false });
  }
  // The block's running total is not read, so this only catches an amount above the cap on its own, which no later
  // block accepts either; retrying cannot help.
  if (rpc.maxPerBlock !== 0n && wad > rpc.maxPerBlock) {
    throw new VaultStateChangedError("per-block", { retryable: false, message: ABOVE_BLOCK_LIMIT });
  }

  const outputReserve = rpc[routeFor(d, request.direction).outputReserve];
  if (outputReserve < quote.amountOut + quote.fee) throw new VaultStateChangedError("reserves");
}

/** The simulated swap must pay out exactly the quote the user confirmed. */
export function assertSimulatedOutput(simulatedOut: bigint, quote: SwapQuote): void {
  if (simulatedOut === quote.amountOut) return;
  const shown = formatAmount(quote.amountOut, VAULT_DECIMALS);
  const now = formatAmount(simulatedOut, VAULT_DECIMALS);
  throw new VaultStateChangedError("quote", {
    retryable: false,
    message: `The vault's quote changed from ${shown} to ${now}. Review the new amount and confirm again.`,
  });
}

/**
 * Settles with `work`, or rejects with a warning after `ms`, or with an `AbortError` `DOMException` as soon as
 * `deps.signal` aborts. `work` itself is not cancelled. The timer's sleep is released once the race is decided.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, deps: SleepDeps): Promise<T> {
  const { signal } = deps;
  return new Promise<T>((resolve, reject) => {
    const timer = new AbortController();
    let decided = false;
    const decide = (settle: () => void) => {
      if (decided) return;
      decided = true;
      signal.removeEventListener("abort", onAbort);
      timer.abort();
      settle();
    };
    const onAbort = () => decide(() => reject(abortError()));
    const onElapsed = () =>
      decide(() => reject(signal.aborted ? abortError() : new AppError(TIMED_OUT, { tone: "warning" })));

    work.then(
      (value) => decide(() => resolve(value)),
      (error: unknown) => decide(() => reject(error))
    );
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    deps.sleep(ms, timer.signal).then(onElapsed, onElapsed);
  });
}

type RetryMode = "pinned" | "unpinned";

function retryModeFor(error: unknown): RetryMode | undefined {
  if (error instanceof ProvidersDisagreeError) return "pinned";
  if (error instanceof VaultStateChangedError && error.retryable) return "unpinned";
  return undefined;
}

async function checkAndSimulate(
  request: VaultRequest,
  d: VaultDeployment,
  owner: Address,
  sources: Sources,
  deps: SleepDeps,
  retryDelayMs: number,
  signal: AbortSignal
): Promise<void> {
  const halted = () => {
    if (signal.aborted) throw abortError();
  };
  const route = routeFor(d, request.direction);
  const calls = buildSnapshotCalls(d, route, owner, request.amountIn);

  // Pinned: both heads, then one aggregate3 each at the lower one. Unpinned: one aggregate3 each at its own latest.
  const attempt = async (pinned: boolean) => {
    halted();
    let block: bigint | undefined;
    if (pinned) {
      const [rpcHead, walletHead] = await Promise.all([sources.rpc.getBlockNumber(), sources.wallet.getBlockNumber()]);
      halted();
      block = pickCommonBlock(rpcHead, walletHead);
    }
    const read = (source: ChainSource) =>
      block === undefined ? source.aggregate3(d.multicall3, calls) : source.aggregate3(d.multicall3, calls, block);
    const [rpcResults, walletResults] = await Promise.all([read(sources.rpc), read(sources.wallet)]);
    halted();
    assertVaultPreflight({
      request,
      deployment: d,
      rpc: decodeSnapshot(route, rpcResults),
      wallet: decodeSnapshot(route, walletResults),
      pinnedBlock: block,
    });
  };

  try {
    await attempt(true);
  } catch (error) {
    const mode = retryModeFor(error);
    if (mode === undefined) throw error;
    // A disagreement is usually one provider a block behind, so it retries at fresh pinned heads. A state change at
    // the pinned block can be a lagging head that has not seen a transaction settled moments ago, so it retries at
    // each provider's latest.
    await deps.sleep(retryDelayMs, signal);
    await attempt(mode === "pinned");
  }

  if (request.kind !== "swap") return;
  const params = {
    vault: d.vault,
    functionName: route.swapFunction,
    account: owner,
    recipient: owner,
    amountIn: request.amountIn,
  };
  const simulate = (source: ChainSource) =>
    source.simulateSwap(params).catch((error: unknown) => {
      throw decodeVaultRevert(error, owner) ?? error;
    });
  const [rpcOut, walletOut] = await Promise.all([simulate(sources.rpc), simulate(sources.wallet)]);
  halted();
  assertSimulatedOutput(rpcOut, request.quote);
  assertSimulatedOutput(walletOut, request.quote);
}

/**
 * Reads the vault through the app's RPC and the wallet's provider, asserts Appendix B, and for a swap simulates it
 * on both. At most one retry, never for the simulation. Transport errors propagate unchanged.
 */
export async function runVaultPreflight(
  request: VaultRequest,
  d: VaultDeployment,
  owner: Address,
  sources: Sources,
  deps: Readonly<{
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
    signal: AbortSignal;
    timeoutMs?: number;
    retryDelayMs?: number;
  }>
): Promise<void> {
  // Aborted by the caller's signal, and once the race below is decided, so that after a timeout a late answer from a
  // provider does not lead to another request.
  const halt = new AbortController();
  const relay = () => halt.abort();
  if (deps.signal.aborted) halt.abort();
  else deps.signal.addEventListener("abort", relay, { once: true });
  try {
    const retryDelayMs = deps.retryDelayMs ?? DISAGREE_RETRY_DELAY_MS;
    const work = checkAndSimulate(request, d, owner, sources, deps, retryDelayMs, halt.signal);
    await withTimeout(work, deps.timeoutMs ?? PREFLIGHT_TIMEOUT_MS, deps);
  } finally {
    halt.abort();
    deps.signal.removeEventListener("abort", relay);
  }
}
