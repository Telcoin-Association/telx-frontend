"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWatchAsset } from "wagmi";
import { Plus as PlusIcon } from "@transferwise/icons";
import { isUserRejection } from "@/hooks/usePositionActions";
import { WALLET_CHAIN_NAMES, type WatchableToken } from "@/lib/walletTokens";

const buttonClassName =
  "flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 duration-200";

/**
 * Asks the connected wallet to track `token` in one prompt, via EIP-747 `wallet_watchAsset`. Hidden without a
 * connected wallet.
 *
 * The request carries no chain id, so the wallet adds the token on the network it is on; the label names that
 * network. A token valid on every supported chain is added wherever the wallet is. A token bound to one chain
 * (`token.chainId`) first switches the wallet there, so its address is never added on a chain where it holds
 * nothing. Declining the prompt or the switch is an ordinary answer and leaves no error. Many WalletConnect mobile
 * wallets do not implement the method, so a failure points at the address, which the surrounding UI always shows.
 */
export default function AddTokenToWallet({ token, className = "" }: { token: WatchableToken; className?: string }) {
  const { isConnected, chain } = useAccount();
  const { watchAsset, isPending, isSuccess, isError, error, reset } = useWatchAsset();
  const { switchChainAsync } = useSwitchChain();
  const [switchNote, setSwitchNote] = useState<string | null>(null);

  // An outcome belongs to the network it happened on, so it clears when the wallet moves.
  const previousChainId = useRef(chain?.id);
  useEffect(() => {
    if (previousChainId.current === chain?.id) return;
    previousChainId.current = chain?.id;
    reset();
  }, [chain?.id, reset]);

  if (!isConnected) return null;

  const network = token.chainId !== undefined ? WALLET_CHAIN_NAMES[token.chainId] : chain?.name;
  const failed = isError && !isUserRejection(error);
  const status = switchNote
    ? switchNote
    : isPending
    ? "Check your wallet to confirm."
    : failed
      ? "Your wallet can't add tokens this way. Copy the address and add it manually."
      : isSuccess
        ? `${token.symbol} added${network ? ` on ${network}` : ""}.`
        : null;

  const add = () =>
    watchAsset({
      type: "ERC20",
      options: {
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
        image: `${window.location.origin}${token.imagePath}`,
      },
    });

  const onClick = async () => {
    setSwitchNote(null);
    if (token.chainId !== undefined && chain?.id !== token.chainId) {
      try {
        await switchChainAsync({ chainId: token.chainId });
      } catch (err) {
        setSwitchNote(
          isUserRejection(err)
            ? `Switch your wallet to ${network} to add ${token.symbol}.`
            : `Your wallet couldn't switch to ${network}. Switch it there, then add ${token.symbol}.`,
        );
        return;
      }
    }
    add();
  };

  return (
    <span className={`inline-flex flex-col items-end gap-0.5 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-busy={isPending}
        className={buttonClassName}
        aria-label={`Add ${token.symbol} to your wallet${network ? ` on ${network}` : ""}`}
        title={`Add ${token.symbol} to your wallet`}
      >
        <PlusIcon />
        <span>Add to wallet</span>
      </button>
      <span aria-live="polite" className="text-right text-xs text-primary">
        {status}
      </span>
    </span>
  );
}
