import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

  // The store and wallet key that setWallet last ran with. Until it has run for this render's store and wallet, the
  // store's snapshot is the previous wallet's (or nobody's, on the first and the server render).
  const [applied, setApplied] = useState<Readonly<{ store: VaultLifecycleStore; walletKey: string }>>();

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
    setApplied((current) => (current?.store === store && current.walletKey === walletKey ? current : { store, walletKey }));
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

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  // For the one render between a wallet change and its setWallet, the snapshot still holds the old wallet's
  // transaction, which the page would adopt into the new network's form. A new context under the same key (a wallet
  // that finished reconnecting) is the same account on the same chain, so its snapshot is not held back.
  const state = applied?.store === store && applied.walletKey === walletKey ? snapshot : INERT_STATE;

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
