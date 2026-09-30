import { decodeFunctionResult, encodeFunctionData, zeroAddress, type Address, type Client, type Hex } from "viem";
import { getBlockNumber, getCode, readContract, simulateContract } from "viem/actions";
import { erc20Abi, multicall3Abi, vaultAbi } from "./abis";
import { directionRoute, routeFor } from "./deployments";
import { AppError } from "./errors";
import type {
  ChainSource,
  Multicall3Call,
  Multicall3Result,
  SwapDirection,
  SwapQuote,
  SwapRoute,
  VaultDeployment,
  VaultPageState,
  VaultSnapshot,
} from "./types";

const READ_FAILED = "The vault's state could not be read. Try again shortly.";

// The previews read `recipient` only to look up the fee whitelist; they do not reject the zero address (only the
// swaps do), and `setWhitelist` refuses it, so a disconnected visitor is quoted the standard fee.
const DISCONNECTED_RECIPIENT: Address = zeroAddress;

type Deployed = Readonly<{ d: VaultDeployment }>;

/**
 * One sub-call of an `aggregate3`: where it goes, what it sends and how its answer decodes. `fallback` is the value
 * for a sub-call that failed or returned undecodable data; without one, such a result fails the whole read.
 */
type Slot<C, V> = Readonly<{
  label: string;
  call(c: C): Readonly<{ target: Address; callData: Hex }>;
  decode(data: Hex): V;
  fallback?: () => V;
}>;

/** Key order is call order. An `undefined` slot is not called. */
type Layout<C> = Readonly<Record<string, Slot<C, unknown> | undefined>>;

type SlotValue<S> = S extends Slot<never, infer V> ? V : undefined;

type Decoded<L> = { [K in keyof L]: SlotValue<L[K]> };

const CHAIN_ID: Slot<Deployed, number> = {
  label: "Multicall3.getChainId",
  call: ({ d }) => ({
    target: d.multicall3,
    callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getChainId" }),
  }),
  decode: (data) => Number(decodeFunctionResult({ abi: multicall3Abi, functionName: "getChainId", data })),
};

const BLOCK_NUMBER: Slot<Deployed, bigint> = {
  label: "Multicall3.getBlockNumber",
  call: ({ d }) => ({
    target: d.multicall3,
    callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getBlockNumber" }),
  }),
  decode: (data) => decodeFunctionResult({ abi: multicall3Abi, functionName: "getBlockNumber", data }),
};

function vaultAddress(functionName: "STABLE" | "GEM"): Slot<Deployed, Address> {
  return {
    label: `vault.${functionName}`,
    call: ({ d }) => ({ target: d.vault, callData: encodeFunctionData({ abi: vaultAbi, functionName }) }),
    decode: (data) => decodeFunctionResult({ abi: vaultAbi, functionName, data }),
  };
}

function vaultUint(functionName: "maxPerTransaction" | "maxPerBlock"): Slot<Deployed, bigint> {
  return {
    label: `vault.${functionName}`,
    call: ({ d }) => ({ target: d.vault, callData: encodeFunctionData({ abi: vaultAbi, functionName }) }),
    decode: (data) => decodeFunctionResult({ abi: vaultAbi, functionName, data }),
  };
}

const VAULT_PAUSED: Slot<Deployed, boolean> = {
  label: "vault.paused",
  call: ({ d }) => ({ target: d.vault, callData: encodeFunctionData({ abi: vaultAbi, functionName: "paused" }) }),
  decode: (data) => decodeFunctionResult({ abi: vaultAbi, functionName: "paused", data }),
};

const STABLE_PAUSED: Slot<Deployed, boolean> = {
  label: "eUSD.paused",
  call: ({ d }) => ({ target: d.stable, callData: encodeFunctionData({ abi: erc20Abi, functionName: "paused" }) }),
  decode: (data) => decodeFunctionResult({ abi: erc20Abi, functionName: "paused", data }),
};

const RESERVES: Slot<Deployed, Readonly<{ stableReserve: bigint; gemReserve: bigint }>> = {
  label: "vault.getReserves",
  call: ({ d }) => ({ target: d.vault, callData: encodeFunctionData({ abi: vaultAbi, functionName: "getReserves" }) }),
  decode: (data) => {
    const [stableReserve, gemReserve] = decodeFunctionResult({ abi: vaultAbi, functionName: "getReserves", data });
    return { stableReserve, gemReserve };
  },
};

/** Unknown counts as paused. */
function failClosed(slot: Slot<Deployed, boolean>): Slot<Deployed, boolean> {
  return { ...slot, fallback: () => true };
}

/** A failed preview is not an error here: the caller shows no quote, and the preflight refuses to go on. */
function preview<C extends Deployed>(
  direction: SwapDirection,
  args: (c: C) => readonly [amountIn: bigint, recipient: Address]
): Slot<C, SwapQuote | undefined> {
  const functionName = directionRoute(direction).previewFunction;
  return {
    label: `vault.${functionName}`,
    call: (c) => ({ target: c.d.vault, callData: encodeFunctionData({ abi: vaultAbi, functionName, args: args(c) }) }),
    decode: (data) => {
      const [amountOut, fee] = decodeFunctionResult({ abi: vaultAbi, functionName, data });
      return { amountOut, fee };
    },
    fallback: () => undefined,
  };
}

function balanceOf<C extends Deployed>(
  label: string,
  token: (d: VaultDeployment) => Address,
  owner: (c: C) => Address
): Slot<C, bigint> {
  return {
    label: `${label}.balanceOf`,
    call: (c) => ({
      target: token(c.d),
      callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner(c)] }),
    }),
    decode: (data) => decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data }),
  };
}

/** The spender is always the vault. */
function allowance<C extends Deployed>(
  label: string,
  token: (d: VaultDeployment) => Address,
  owner: (c: C) => Address
): Slot<C, bigint> {
  return {
    label: `${label}.allowance`,
    call: (c) => ({
      target: token(c.d),
      callData: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner(c), c.d.vault] }),
    }),
    decode: (data) => decodeFunctionResult({ abi: erc20Abi, functionName: "allowance", data }),
  };
}

const stableToken = (d: VaultDeployment): Address => d.stable;
const gemToken = (d: VaultDeployment): Address => d.gem;

type SnapshotContext = Readonly<{ d: VaultDeployment; owner: Address; amountIn: bigint }>;

// The preflight's snapshot. The input token is taken from the deployment, not from the caller's route, so every
// target is pinned.
function snapshotLayout(direction: SwapDirection) {
  const tokenIn = (d: VaultDeployment): Address => routeFor(d, direction).tokenIn;
  const owner = (c: SnapshotContext): Address => c.owner;
  return {
    chainId: CHAIN_ID,
    blockNumber: BLOCK_NUMBER,
    stable: vaultAddress("STABLE"),
    gem: vaultAddress("GEM"),
    vaultPaused: VAULT_PAUSED,
    stablePaused: STABLE_PAUSED,
    reserves: RESERVES,
    maxPerTransaction: vaultUint("maxPerTransaction"),
    maxPerBlock: vaultUint("maxPerBlock"),
    quote: preview(direction, (c: SnapshotContext) => [c.amountIn, c.owner]),
    balanceIn: balanceOf("tokenIn", tokenIn, owner),
    allowanceIn: allowance("tokenIn", tokenIn, owner),
  };
}

function ownerReads(owner: Address) {
  const self = (): Address => owner;
  return {
    stableBalance: balanceOf("eUSD", stableToken, self),
    gemBalance: balanceOf("USDC", gemToken, self),
    stableAllowance: allowance("eUSD", stableToken, self),
    gemAllowance: allowance("USDC", gemToken, self),
  };
}

function pageStateLayout(direction: SwapDirection, owner: Address | undefined, amountIn: bigint | undefined) {
  const recipient = owner ?? DISCONNECTED_RECIPIENT;
  const quote =
    amountIn !== undefined && amountIn > 0n ? preview<Deployed>(direction, () => [amountIn, recipient]) : undefined;
  const wallet = owner === undefined ? undefined : ownerReads(owner);
  return {
    chainId: CHAIN_ID,
    blockNumber: BLOCK_NUMBER,
    stable: vaultAddress("STABLE"),
    gem: vaultAddress("GEM"),
    vaultPaused: failClosed(VAULT_PAUSED),
    stablePaused: failClosed(STABLE_PAUSED),
    reserves: RESERVES,
    maxPerTransaction: vaultUint("maxPerTransaction"),
    maxPerBlock: vaultUint("maxPerBlock"),
    quote,
    stableBalance: wallet?.stableBalance,
    gemBalance: wallet?.gemBalance,
    stableAllowance: wallet?.stableAllowance,
    gemAllowance: wallet?.gemAllowance,
  };
}

function buildCalls<C>(
  layout: Layout<C>,
  c: C,
  allowFailure: (slot: Slot<C, unknown>) => boolean
): readonly Multicall3Call[] {
  const calls: Multicall3Call[] = [];
  for (const slot of Object.values(layout)) {
    if (slot === undefined) continue;
    calls.push({ ...slot.call(c), allowFailure: allowFailure(slot) });
  }
  return calls;
}

function readFailed(detail: string, cause?: unknown): AppError {
  return new AppError(READ_FAILED, { cause: new Error(detail, cause === undefined ? undefined : { cause }) });
}

function decodeResult<V>(slot: Slot<never, V>, result: Multicall3Result, index: number): V {
  let failure: unknown;
  if (result.success) {
    try {
      return slot.decode(result.returnData);
    } catch (error) {
      failure = error;
    }
  }
  if (slot.fallback) return slot.fallback();
  const what = result.success ? "returned undecodable data" : "failed";
  throw readFailed(`Multicall3 sub-call ${index} (${slot.label}) ${what}`, failure);
}

function decodeLayout<L extends Layout<never>>(layout: L, results: readonly Multicall3Result[]): Decoded<L> {
  const entries = Object.entries(layout);
  const expected = entries.filter(([, slot]) => slot !== undefined).length;
  if (results.length !== expected) {
    throw readFailed(`Multicall3 returned ${results.length} results for ${expected} calls`);
  }
  const values: Record<string, unknown> = {};
  let index = 0;
  for (const [key, slot] of entries) {
    if (slot === undefined) {
      values[key] = undefined;
      continue;
    }
    values[key] = decodeResult(slot, results[index], index);
    index += 1;
  }
  return values as Decoded<L>;
}

/** The preflight's read of the vault and the wallet's input token. Only the preview may fail. */
export function buildSnapshotCalls(
  d: VaultDeployment,
  route: SwapRoute,
  owner: Address,
  amountIn: bigint
): readonly Multicall3Call[] {
  return buildCalls<SnapshotContext>(
    snapshotLayout(route.direction),
    { d, owner, amountIn },
    (slot) => slot.fallback !== undefined
  );
}

export function decodeSnapshot(route: SwapRoute, results: readonly Multicall3Result[]): VaultSnapshot {
  const v = decodeLayout(snapshotLayout(route.direction), results);
  return {
    chainId: v.chainId,
    blockNumber: v.blockNumber,
    stable: v.stable,
    gem: v.gem,
    vaultPaused: v.vaultPaused,
    stablePaused: v.stablePaused,
    stableReserve: v.reserves.stableReserve,
    gemReserve: v.reserves.gemReserve,
    maxPerTransaction: v.maxPerTransaction,
    maxPerBlock: v.maxPerBlock,
    quote: v.quote,
    balanceIn: v.balanceIn,
    allowanceIn: v.allowanceIn,
  };
}

/**
 * The page's read. Every sub-call may fail so one bad answer does not hide the rest; the decoder decides what a
 * failure means. The preview is read only for an amount above zero, the wallet's balances and allowances only when
 * a wallet is connected.
 */
export function buildPageStateCalls(
  d: VaultDeployment,
  direction: SwapDirection,
  owner: Address | undefined,
  amountIn: bigint | undefined
): readonly Multicall3Call[] {
  return buildCalls(pageStateLayout(direction, owner, amountIn), { d }, () => true);
}

/** Takes the builder's `direction`, `owner` and `amountIn` to know which optional calls are present. */
export function decodePageState(
  direction: SwapDirection,
  owner: Address | undefined,
  amountIn: bigint | undefined,
  results: readonly Multicall3Result[]
): VaultPageState {
  const v = decodeLayout(pageStateLayout(direction, owner, amountIn), results);
  return {
    chainId: v.chainId,
    blockNumber: v.blockNumber,
    stable: v.stable,
    gem: v.gem,
    vaultPaused: v.vaultPaused,
    stablePaused: v.stablePaused,
    stableReserve: v.reserves.stableReserve,
    gemReserve: v.reserves.gemReserve,
    maxPerTransaction: v.maxPerTransaction,
    maxPerBlock: v.maxPerBlock,
    quote: v.quote,
    balances:
      v.stableBalance !== undefined && v.gemBalance !== undefined
        ? { stable: v.stableBalance, gem: v.gemBalance }
        : undefined,
    allowances:
      v.stableAllowance !== undefined && v.gemAllowance !== undefined
        ? { stable: v.stableAllowance, gem: v.gemAllowance }
        : undefined,
  };
}

/** The one `ChainSource` over a viem client. Errors pass through untouched; callers decode them. */
export function createClientChainSource(client: Client): ChainSource {
  return {
    getBlockNumber: () => getBlockNumber(client, { cacheTime: 0 }),
    // `readContract` rather than viem's `multicall`, which splits large calldata into several requests.
    aggregate3: (multicall3, calls, blockNumber) =>
      readContract(client, {
        address: multicall3,
        abi: multicall3Abi,
        functionName: "aggregate3",
        args: [calls],
        blockNumber,
      }),
    simulateSwap: async ({ vault, functionName, account, recipient, amountIn }) => {
      const { result } = await simulateContract(client, {
        address: vault,
        abi: vaultAbi,
        functionName,
        args: [recipient, amountIn],
        account,
      });
      return result;
    },
    getCode: async (address) => {
      const code = await getCode(client, { address });
      return code && code !== "0x" ? code : undefined;
    },
  };
}
