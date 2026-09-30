import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import { createVaultLifecycleStore } from "@/web3/eusdVault/lifecycleStore";
import type {
  ApproveRequest,
  LiveAllowance,
  SwapRequest,
  VaultLifecycle,
  VaultLifecycleDeps,
  VaultLifecycleState,
  VaultLifecycleStore,
  VaultLiveState,
} from "@/web3/eusdVault/types";

const INERT_STATE: VaultLifecycleState = Object.freeze({ status: "idle", smartAccount: false, canSubmit: false });

/** Stands in for the store until the page has dependencies (first render, server): idle, and every action a no-op. */
const INERT_STORE: VaultLifecycleStore = Object.freeze({
  subscribe: () => () => undefined,
  getSnapshot: () => INERT_STATE,
  getServerSnapshot: () => INERT_STATE,
  setWallet: () => undefined,
  setLive: () => undefined,
  submit: () => Promise.resolve(),
  acknowledge: () => undefined,
  dismissPending: () => undefined,
  done: () => undefined,
  dispose: () => undefined,
});

function liveAllowance(value: bigint | undefined, updatedAt: number | undefined): LiveAllowance | undefined {
  return value === undefined && updatedAt === undefined ? undefined : { value, updatedAt };
}

/**
 * Binds the vault lifecycle store to the connected wallet. The page builds `deps` (`createWagmiVaultDeps(config)`)
 * and passes them in; until it does, the hook is inert. A new `deps` object gets a new store.
 */
export function useVaultLifecycle(o: Readonly<{ live: VaultLiveState }>, deps: VaultLifecycleDeps | undefined): VaultLifecycle {
  const { address, chainId, connector, status } = useAccount();
  const store = useMemo(() => (deps ? createVaultLifecycleStore(deps) : INERT_STORE), [deps]);

  const walletKey = `${address?.toLowerCase() ?? "disconnected"}:${chainId ?? "no-chain"}:${connector?.uid ?? "no-connector"}`;
  // Resume and persistence wait for a real connection: while wagmi reconnects the connector is a storage stub and
  // the account may still change.
  const connectorId = status === "connected" ? connector?.id : undefined;

  // Runs before setLive so live state applies to the wallet's records. Never guarded to run once: StrictMode's
  // remount replays it after `dispose`, and only a new setWallet lets the store accept submissions again.
  useEffect(() => {
    store.setWallet({
      walletKey,
      context:
        address !== undefined && chainId !== undefined && connectorId !== undefined
          ? { chainId, address, connectorId }
          : undefined,
      connector,
    });
  }, [store, walletKey, address, chainId, connectorId, connector]);

  // Keyed on the values, not on `o.live`, whose identity changes every render.
  const { usdcToEusd, eusdToUsdc } = o.live.allowances;
  const usdcValue = usdcToEusd?.value;
  const usdcUpdatedAt = usdcToEusd?.updatedAt;
  const eusdValue = eusdToUsdc?.value;
  const eusdUpdatedAt = eusdToUsdc?.updatedAt;
  useEffect(() => {
    const usdc = liveAllowance(usdcValue, usdcUpdatedAt);
    const eusd = liveAllowance(eusdValue, eusdUpdatedAt);
    store.setLive({
      allowances: { ...(usdc ? { usdcToEusd: usdc } : {}), ...(eusd ? { eusdToUsdc: eusd } : {}) },
    });
  }, [store, usdcValue, usdcUpdatedAt, eusdValue, eusdUpdatedAt]);

  useEffect(() => () => store.dispose(), [store]);

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  const approve = useCallback(
    (r: Omit<ApproveRequest, "kind">) => store.submit({ ...r, kind: "approve" }),
    [store]
  );
  const swap = useCallback((r: Omit<SwapRequest, "kind">) => store.submit({ ...r, kind: "swap" }), [store]);
  const acknowledge = useCallback(() => store.acknowledge(), [store]);
  const dismissPending = useCallback(() => store.dismissPending(), [store]);
  const done = useCallback(() => store.done(), [store]);

  return { state, approve, swap, acknowledge, dismissPending, done };
}
