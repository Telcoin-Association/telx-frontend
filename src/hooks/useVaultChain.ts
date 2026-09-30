import { useCallback, useMemo, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { VAULT_DEPLOYMENTS, isVaultChainId } from "@/web3/eusdVault/deployments";
import { describeError } from "@/web3/eusdVault/errors";
import type { ErrorDescription, VaultChainId, VaultDeployment } from "@/web3/eusdVault/types";

export type VaultChain = Readonly<{
  /** The chain the page shows and reads. */
  selectedChainId: VaultChainId;
  deployment: VaultDeployment;
  isConnected: boolean;
  walletChainId?: number;
  /** Connected, and the wallet's chain is not a vault chain. */
  isWrongNetwork: boolean;
  isSwitching: boolean;
  /** The last failed switch. Cleared on the next attempt or when the wallet's chain changes. */
  switchError?: ErrorDescription;
  selectChain(chainId: VaultChainId): void;
}>;

const DEFAULT_CHAIN_ID: VaultChainId = 1;

const SWITCH_FAILED = "Your wallet did not switch networks. Try again, or switch networks in your wallet.";

/**
 * Which vault chain the page shows. Disconnected, it is a page-local choice starting on Ethereum. Connected on a
 * vault chain, it follows the wallet, and choosing another chain asks the wallet to switch. The wallet is only
 * ever asked from `selectChain`, never on mount or render.
 */
export function useVaultChain(): VaultChain {
  const account = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  const isConnected = account.isConnected;
  const walletChainId = isConnected ? account.chainId : undefined;
  const walletVaultChainId = isVaultChainId(walletChainId) ? walletChainId : undefined;
  // While wagmi reconnects the wallet's chain can be unknown; that is not a wrong network.
  const isWrongNetwork = isConnected && walletChainId !== undefined && walletVaultChainId === undefined;

  const [localChainId, setLocalChainId] = useState<VaultChainId>(DEFAULT_CHAIN_ID);
  // Keep the local choice on the wallet's chain, so a disconnect keeps showing the same chain.
  if (walletVaultChainId !== undefined && walletVaultChainId !== localChainId) {
    setLocalChainId(walletVaultChainId);
  }
  const selectedChainId = walletVaultChainId ?? localChainId;

  const [switchError, setSwitchError] = useState<ErrorDescription>();
  const [previousWalletChainId, setPreviousWalletChainId] = useState(walletChainId);
  if (walletChainId !== previousWalletChainId) {
    setPreviousWalletChainId(walletChainId);
    setSwitchError(undefined);
  }

  const selectChain = useCallback(
    (chainId: VaultChainId) => {
      if (!isVaultChainId(chainId)) return;
      if (!isConnected) {
        setLocalChainId(chainId);
        return;
      }
      if (chainId === walletVaultChainId) return;
      // On a wrong network the page has no wallet chain to follow, so it shows the requested chain at once.
      if (walletVaultChainId === undefined) setLocalChainId(chainId);
      setSwitchError(undefined);
      switchChain({ chainId }, { onError: (error) => setSwitchError(describeError(error, SWITCH_FAILED)) });
    },
    [isConnected, walletVaultChainId, switchChain]
  );

  return useMemo(
    () => ({
      selectedChainId,
      deployment: VAULT_DEPLOYMENTS[selectedChainId],
      isConnected,
      walletChainId,
      isWrongNetwork,
      isSwitching: isPending,
      switchError,
      selectChain,
    }),
    [selectedChainId, isConnected, walletChainId, isWrongNetwork, isPending, switchError, selectChain]
  );
}
