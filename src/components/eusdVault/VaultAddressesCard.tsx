"use client";

import React, { useId, useState } from "react";
import { chainDisplayName } from "@/lib/poolTitle";
import type { VaultDeployment } from "@/web3/eusdVault/types";
import { VaultCard } from "./VaultCard";

export type VaultAddressesCardProps = Readonly<{
  deployment: VaultDeployment;
  /** Applied to the card's outer frame, for the page's width and placement. */
  className?: string;
}>;

/** "Official Contract Addresses": the vault and both tokens on the deployment's chain, with explorer links. */
export function VaultAddressesCard({ deployment, className }: VaultAddressesCardProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const chainName = chainDisplayName(deployment.chainKey);
  const items = [
    { title: "Vault contract", linkName: "vault contract", address: deployment.vault },
    { title: "eUSD", linkName: "eUSD token contract", address: deployment.stable },
    { title: "USDC", linkName: "USDC token contract", address: deployment.gem },
  ];

  return (
    <VaultCard className={className}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-xl md:text-2xl">Official Contract Addresses</h2>
            <p className="text-sm text-primary md:text-base">For security, always verify before interacting.</p>
          </div>
          {/* On small screens the list starts collapsed so the swap card stays near the top. */}
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="shrink-0 text-left text-white lg:hidden"
            aria-expanded={open}
            aria-controls={listId}
            aria-label="Toggle contract addresses"
          >
            <svg
              className={open ? "h-8 w-8 shrink-0 rotate-180 text-white/70 transition" : "h-8 w-8 shrink-0 text-white/70 transition"}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <div id={listId} className={open ? "flex min-w-0 flex-col gap-4" : "hidden min-w-0 flex-col gap-4 lg:flex"}>
          <ul className="flex min-w-0 flex-col gap-4">
            {items.map(item => (
              <li
                key={item.title}
                className="flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-2xl bg-black/40 px-3 py-3 sm:px-4"
              >
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="text-sm font-bold">{item.title}</p>
                  <p className="truncate text-sm text-primary">{chainName}</p>
                  <p className="mt-0.5 font-mono text-xs break-all text-white/90 sm:text-sm">{item.address}</p>
                </div>
                <a
                  href={`${deployment.explorerUrl}/address/${item.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 self-center p-1 text-white"
                  aria-label={`View the ${item.linkName} on the explorer`}
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M11.6667 4.16667C11.2064 4.16667 10.8333 3.79357 10.8333 3.33333C10.8333 2.8731 11.2064 2.5 11.6667 2.5H16.6667C17.1269 2.5 17.5 2.8731 17.5 3.33333V8.33333C17.5 8.79357 17.1269 9.16667 16.6667 9.16667C16.2064 9.16667 15.8333 8.79357 15.8333 8.33333V5.34518L8.92259 12.2559C8.59715 12.5814 8.06951 12.5814 7.74408 12.2559C7.41864 11.9305 7.41864 11.4028 7.74408 11.0774L14.6548 4.16667H11.6667ZM5 5.83333C4.53976 5.83333 4.16667 6.20643 4.16667 6.66667V15C4.16667 15.4602 4.53976 15.8333 5 15.8333H13.3333C13.7936 15.8333 14.1667 15.4602 14.1667 15V11.6667C14.1667 11.2064 14.5398 10.8333 15 10.8333C15.4602 10.8333 15.8333 11.2064 15.8333 11.6667V15C15.8333 16.3807 14.714 17.5 13.3333 17.5H5C3.61929 17.5 2.5 16.3807 2.5 15V6.66667C2.5 5.28595 3.61929 4.16667 5 4.16667H8.33333C8.79357 4.16667 9.16667 4.53976 9.16667 5C9.16667 5.46024 8.79357 5.83333 8.33333 5.83333H5Z"
                      fill="currentColor"
                    />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 gap-2">
            <div className="mt-1 shrink-0 text-status-inProgress">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <line x1="12" y1="10" x2="12" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="7" r="1" fill="currentColor" />
              </svg>
            </div>
            <p className="min-w-0 text-sm sm:text-base">
              TELx will never ask for your recovery phrase or ask you to send funds to a support address. Only approve the vault contract
              shown here, and check that your wallet shows the same address before you confirm.
            </p>
          </div>
        </div>
      </div>
    </VaultCard>
  );
}
