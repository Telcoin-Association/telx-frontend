"use client";

/**
 * Toast notifications for the eUSD vault, using the shared Toast design the way `merklToasts.tsx` does.
 */

import React from "react";
import { toast } from "react-toastify";
import Toast from "@/components/toast/Toast";
import type { ErrorDescription } from "@/web3/eusdVault/types";

export type VaultApprovalToastParams = Readonly<{ symbol: string }>;

export type VaultSwapToastParams = Readonly<{ amountOutLabel: string; symbolOut: string; href?: string }>;

export function notifyVaultApprovalConfirmed({ symbol }: VaultApprovalToastParams) {
  toast.success(
    <Toast status="success" title="Approval Confirmed" description={`Your ${symbol} approval for the vault is confirmed. You can now swap.`} />,
    { toastId: "vault-approval-confirmed", autoClose: 10000, draggable: true },
  );
}

export function notifyVaultSwapConfirmed({ amountOutLabel, symbolOut, href }: VaultSwapToastParams) {
  toast.success(
    <div>
      <Toast status="success" title="Swap Confirmed" description={`You received ${amountOutLabel} ${symbolOut}.`} />
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 block pl-5 text-sm text-tblue-700 underline">
          View transaction
        </a>
      ) : null}
    </div>,
    { toastId: "vault-swap-confirmed", autoClose: 10000, draggable: true },
  );
}

/** A rejection or a cancel (info tone) is the user's own choice, so it gets the neutral toast, not the error one. */
export function notifyVaultError({ tone, message }: ErrorDescription) {
  if (tone === "info") {
    toast.info(<Toast status="pending" title="Transaction Cancelled" description={message} />, {
      toastId: "vault-cancelled",
      autoClose: 6000,
      draggable: true,
    });
    return;
  }
  if (tone === "warning") {
    toast.warning(<Toast status="pending" title="Transaction Not Completed" description={message} />, {
      toastId: "vault-warning",
      autoClose: 10000,
      draggable: true,
    });
    return;
  }
  toast.error(<Toast status="error" title="Transaction Failed" description={message} />, {
    toastId: "vault-error",
    autoClose: 10000,
    draggable: true,
  });
}
