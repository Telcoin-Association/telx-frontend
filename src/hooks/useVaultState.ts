import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAddressEqual, type Address } from "viem";
import { describeError, QuoteUnavailableError, VaultIdentityError } from "@/web3/eusdVault/errors";
import { buildPageStateCalls, decodePageState } from "@/web3/eusdVault/reads";
import type {
  ChainSource,
  ErrorDescription,
  QuoteState,
  SettleObservation,
  SwapDirection,
  VaultDeployment,
  VaultPageState,
} from "@/web3/eusdVault/types";

export const VAULT_REFRESH_MS = 15_000;
export const QUOTE_DEBOUNCE_MS = 400;

export type VaultStateInput = Readonly<{
  deployment: VaultDeployment;
  direction: SwapDirection;
  /** The connected wallet, if any. */
  owner?: Address;
  /** The form's parsed amount when valid and above zero, else undefined. */
  amountIn?: bigint;
  /** The app's source for `deployment.chainId`. */
  source: ChainSource | undefined;
}>;

export type VaultState = Readonly<{
  /** The last verified read for this chain and owner; undefined until verified. */
  state?: VaultPageState;
  /** No verified read yet and one is in flight. */
  isVerifying: boolean;
  /** The latest read's chain id, `STABLE` and `GEM` match the pinned deployment. */
  isContractVerified: boolean;
  /** The latest read failed, there is no source, or the identity did not match. */
  isSecurityCheckUnavailable: boolean;
  /** `vaultPaused || stablePaused`; true without a verified read. */
  paused: boolean;
  quote: QuoteState;
  /** The read failure, for the notice. */
  error?: ErrorDescription;
  /** `Date.now()` when the request that produced `state` was sent. */
  updatedAt?: number;
  /** Reads at once; resolves with the input token's allowance and the read's block, or `{}`. Never rejects. */
  refetch(): Promise<SettleObservation>;
}>;

/** One verified page read, tagged with what it was read for. */
type PageRead = Readonly<{
  chainId: number;
  owner: string | null;
  direction: SwapDirection;
  amountIn?: bigint;
  readAt: number;
  state: VaultPageState;
}>;

function ownerKey(owner: Address | undefined): string | null {
  return owner === undefined ? null : owner.toLowerCase();
}

function assertIdentity(d: VaultDeployment, s: VaultPageState): void {
  if (s.chainId !== d.chainId) throw new VaultIdentityError("chain");
  if (!isAddressEqual(s.stable, d.stable) || !isAddressEqual(s.gem, d.gem)) {
    throw new VaultIdentityError("contracts");
  }
}

async function readPageState(
  source: ChainSource,
  d: VaultDeployment,
  direction: SwapDirection,
  owner: Address | undefined,
  amountIn: bigint | undefined
): Promise<PageRead> {
  const readAt = Date.now();
  const results = await source.aggregate3(d.multicall3, buildPageStateCalls(d, direction, owner, amountIn));
  const state = decodePageState(direction, owner, amountIn, results);
  assertIdentity(d, state);
  return { chainId: d.chainId, owner: ownerKey(owner), direction, amountIn, readAt, state };
}

function allowanceIn(read: PageRead): bigint | undefined {
  const allowances = read.state.allowances;
  if (allowances === undefined) return undefined;
  return read.direction === "usdcToEusd" ? allowances.gem : allowances.stable;
}

/**
 * The amount that enters the query key: a typed amount 400 ms after it stops changing, a cleared amount at once so
 * the next refresh stops previewing it.
 */
function useDebouncedAmount(amountIn: bigint | undefined): bigint | undefined {
  const [debounced, setDebounced] = useState(amountIn);
  if (amountIn === undefined && debounced !== undefined) setDebounced(undefined);
  useEffect(() => {
    if (amountIn === undefined) return;
    const timer = setTimeout(() => setDebounced(amountIn), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [amountIn]);
  return amountIn === undefined ? undefined : debounced;
}

/**
 * The vault page's live state: one Multicall3 `aggregate3` per refresh, gated on the vault's identity. Only the
 * connected wallet's own reads are ever returned; a read is shown while a new one loads only when it was made for
 * the same chain and owner.
 */
export function useVaultState(i: VaultStateInput): VaultState {
  const { deployment, direction, owner, source } = i;
  const amountIn = i.amountIn !== undefined && i.amountIn > 0n ? i.amountIn : undefined;
  const debouncedAmount = useDebouncedAmount(amountIn);
  const chainId = deployment.chainId;
  const wallet = ownerKey(owner);

  const query = useQuery({
    queryKey: ["eusdVault", "pageState", chainId, wallet, direction, debouncedAmount?.toString() ?? null],
    queryFn: () => {
      if (source === undefined) throw new Error("No chain source");
      return readPageState(source, deployment, direction, owner, debouncedAmount);
    },
    enabled: source !== undefined,
    // Keeps the last read while only the amount or direction changes; another chain's or wallet's never shows.
    placeholderData: (previous: PageRead | undefined) =>
      previous !== undefined && previous.chainId === chainId && previous.owner === wallet ? previous : undefined,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: VAULT_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // A mismatched identity will not change on a second ask.
    retry: (failureCount, error) => failureCount < 1 && !(error instanceof VaultIdentityError),
  });

  const { refetch: refetchQuery } = query;

  // react-query only watches `visibilitychange`, and a wallet popup takes focus without hiding the tab.
  useEffect(() => {
    if (source === undefined) return;
    const onFocus = () => void refetchQuery({ cancelRefetch: false });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [source, refetchQuery]);

  const refetch = useCallback(async (): Promise<SettleObservation> => {
    if (source === undefined) return {};
    try {
      // Joins a read already in flight rather than sending a second request.
      const result = await refetchQuery({ cancelRefetch: false });
      if (result.isError || result.isPlaceholderData || result.data === undefined) return {};
      return { allowanceIn: allowanceIn(result.data), blockNumber: result.data.state.blockNumber };
    } catch {
      return {};
    }
  }, [source, refetchQuery]);

  const failed = source === undefined || query.isError;
  const identityFailed = query.error instanceof VaultIdentityError;
  const data = query.data;
  const read =
    source !== undefined && !identityFailed && data !== undefined && data.chainId === chainId && data.owner === wallet
      ? data
      : undefined;
  const state = read?.state;
  const error = query.isError ? describeError(query.error) : undefined;

  let quote: QuoteState;
  if (amountIn === undefined) {
    quote = { status: "idle" };
  } else if (failed) {
    quote = { status: "error", error };
  } else if (
    debouncedAmount !== amountIn ||
    read === undefined ||
    read.direction !== direction ||
    read.amountIn !== amountIn
  ) {
    quote = { status: "loading" };
  } else if (read.state.quote === undefined) {
    quote = { status: "error", error: describeError(new QuoteUnavailableError()) };
  } else {
    quote = { status: "ready", direction, amountIn, quote: read.state.quote };
  }

  return {
    state,
    isVerifying: !failed && state === undefined,
    isContractVerified: !failed && state !== undefined,
    isSecurityCheckUnavailable: failed,
    paused: state === undefined || state.vaultPaused || state.stablePaused,
    quote,
    error,
    updatedAt: read?.readAt,
    refetch,
  };
}
