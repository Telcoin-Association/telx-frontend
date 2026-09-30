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

/** `href` links the transaction the failure is about; `title` replaces the tone's default heading. */
export type VaultErrorToastOptions = Readonly<{ href?: string; title?: string }>;

function TransactionLink({ href }: Readonly<{ href: string }>) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 block pl-5 text-sm text-tblue-700 underline">
      View transaction
    </a>
  );
}

function withTransactionLink(content: React.ReactElement, href: string | undefined): React.ReactElement {
  if (!href) return content;
  return (
    <div>
      {content}
      <TransactionLink href={href} />
    </div>
  );
}

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
      {href ? <TransactionLink href={href} /> : null}
    </div>,
    { toastId: "vault-swap-confirmed", autoClose: 10000, draggable: true },
  );
}

/**
 * A rejection or a cancel (info tone) is the user's own choice, so it gets the neutral toast, not the error one. The
 * warning tone covers every failure where the vault or the wallet changed under the request, so its default title
 * stays neutral; a caller with a more specific heading passes `title`.
 */
export function notifyVaultError({ tone, message }: ErrorDescription, { href, title }: VaultErrorToastOptions = {}) {
  if (tone === "info") {
    toast.info(
      withTransactionLink(<Toast status="pending" title={title ?? "Transaction Cancelled"} description={message} />, href),
      { toastId: "vault-cancelled", autoClose: 6000, draggable: true },
    );
    return;
  }
  if (tone === "warning") {
    toast.warning(
      withTransactionLink(<Toast status="pending" title={title ?? "Transaction Not Completed"} description={message} />, href),
      { toastId: "vault-warning", autoClose: 10000, draggable: true },
    );
    return;
  }
  toast.error(
    withTransactionLink(<Toast status="error" title={title ?? "Transaction Failed"} description={message} />, href),
    { toastId: "vault-error", autoClose: 10000, draggable: true },
  );
}
