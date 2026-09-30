import { useCallback, useEffect, useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAddressEqual, type Address } from "viem";
import { directionRoute } from "@/web3/eusdVault/deployments";
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
/**
 * How long a verified read keeps standing while refreshes fail: four refresh intervals. The preflight re-checks the
 * vault's identity, balances, caps and quote at the click, so a short outage need not disable the form.
 */
export const STALE_READ_LIMIT_MS = 60_000;

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
  /**
   * `state`'s chain id, `STABLE` and `GEM` match the pinned deployment, and `state` is the latest read or, while
   * refreshes fail, younger than `STALE_READ_LIMIT_MS`.
   */
  isContractVerified: boolean;
  /**
   * There is no source, the identity did not match, or reads are failing with no verified read younger than
   * `STALE_READ_LIMIT_MS`.
   */
  isSecurityCheckUnavailable: boolean;
  /** The latest refresh failed and `state` is the last verified read, younger than `STALE_READ_LIMIT_MS`. */
  isStale: boolean;
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
  return read.state.allowances?.[directionRoute(read.direction).inputSide];
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
 * connected wallet's own reads are ever returned; a read is shown while a new one loads, or while refreshes fail,
 * only when it was made for the same chain and owner.
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
    staleTime: 0,
    gcTime: 0,
    refetchInterval: VAULT_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // The chain transports already retry a failed request, and the next refresh comes soon enough.
    retry: false,
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
      if (result.isError || result.data === undefined) return {};
      return { allowanceIn: allowanceIn(result.data), blockNumber: result.data.state.blockNumber };
    } catch {
      return {};
    }
  }, [source, refetchQuery]);

  const identityFailed = query.error instanceof VaultIdentityError;
  const latest = source !== undefined && query.isSuccess ? query.data : undefined;
  // The last verified read for this chain and owner, shown while a new read loads or a refresh fails. Another chain's
  // or wallet's is dropped at once, and so is everything read before an identity mismatch.
  const [kept, setKept] = useState<PageRead>();
  const keptHere = kept !== undefined && kept.chainId === chainId && kept.owner === wallet ? kept : undefined;
  const read = source === undefined || identityFailed ? undefined : (latest ?? keptHere);
  if (read !== kept) setKept(read);

  // A failed refresh leaves the form usable on the kept read until it is STALE_READ_LIMIT_MS old. A timer re-renders
  // at that moment, so the switch to unavailable needs no further request to fail.
  const staleUntil = query.isError && read !== undefined ? read.readAt + STALE_READ_LIMIT_MS : undefined;
  const isStale = staleUntil !== undefined && Date.now() < staleUntil;
  const [, wake] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!isStale || staleUntil === undefined) return;
    const timer = setTimeout(wake, staleUntil - Date.now());
    return () => clearTimeout(timer);
  }, [isStale, staleUntil]);

  const failed = source === undefined || (query.isError && !isStale);
  const state = read?.state;
  const error = query.isError ? describeError(query.error) : undefined;
  const readForInput = read !== undefined && read.direction === direction && read.amountIn === amountIn ? read : undefined;

  let quote: QuoteState;
  if (amountIn === undefined) {
    quote = { status: "idle" };
  } else if (failed || (isStale && readForInput === undefined)) {
    quote = { status: "error", error };
  } else if (debouncedAmount !== amountIn || readForInput === undefined) {
    quote = { status: "loading" };
  } else if (readForInput.state.quote === undefined) {
    quote = { status: "error", error: describeError(new QuoteUnavailableError()) };
  } else {
    quote = { status: "ready", direction, amountIn, quote: readForInput.state.quote };
  }

  return {
    state,
    isVerifying: !failed && state === undefined,
    isContractVerified: !failed && state !== undefined,
    isSecurityCheckUnavailable: failed,
    isStale,
    paused: state === undefined || state.vaultPaused || state.stablePaused,
    quote,
    error,
    updatedAt: read?.readAt,
    refetch,
  };
}
