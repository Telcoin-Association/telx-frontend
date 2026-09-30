"use client";

import React, { useEffect, useRef } from "react";
import { useAccount, useWatchAsset } from "wagmi";
import { Plus as PlusIcon } from "@transferwise/icons";
import { isUserRejection } from "@/hooks/usePositionActions";
import type { WatchableToken } from "@/lib/walletTokens";

const buttonClassName =
  "flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 duration-200";

/**
 * Asks the connected wallet to track `token` in one prompt, via EIP-747 `wallet_watchAsset`. Hidden without a
 * connected wallet.
 *
 * The request carries no chain id, so the wallet adds the token on the network it is on; the label names that
 * network. The tokens offered have one address on every supported chain, so any of them is correct. Declining
 * the prompt is an ordinary answer and leaves no message. Many WalletConnect mobile wallets do not implement the
 * method, so a failure points at the address, which the surrounding UI always shows.
 */
export default function AddTokenToWallet({ token, className = "" }: { token: WatchableToken; className?: string }) {
  const { isConnected, chain } = useAccount();
  const { watchAsset, isPending, isSuccess, isError, error, reset } = useWatchAsset();

  // An outcome belongs to the network it happened on, so it clears when the wallet moves.
  const previousChainId = useRef(chain?.id);
  useEffect(() => {
    if (previousChainId.current === chain?.id) return;
    previousChainId.current = chain?.id;
    reset();
  }, [chain?.id, reset]);

  if (!isConnected) return null;

  const network = chain?.name;
  const failed = isError && !isUserRejection(error);
  const status = isPending
    ? "Check your wallet to confirm."
    : failed
      ? "Your wallet can't add tokens this way. Copy the address and add it manually."
      : isSuccess
        ? `${token.symbol} added${network ? ` on ${network}` : ""}.`
        : null;

  const onClick = () =>
    watchAsset({
      type: "ERC20",
      options: {
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
        image: `${window.location.origin}${token.imagePath}`,
      },
    });

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
