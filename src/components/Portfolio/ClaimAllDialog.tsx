"use client";

import React, { useEffect, useRef } from "react";
import type { Hash } from "viem";
import ChainLogo from "../common/ChainLogo";
import { chainDisplayName } from "@/lib/poolTitle";
import { formatTel } from "@/lib/portfolioSummary";
import { formatUsd } from "@/lib/positionView";
import type { ClaimRow } from "@/lib/claims/claimPlan";
import type { ClaimRowStatus } from "@/lib/claims/claimRunner";
import type { ClaimAll } from "@/hooks/useClaimAll";

const EXPLORERS: Record<ClaimRow["chain"], string> = {
  ethereum: "https://etherscan.io",
  base: "https://basescan.org",
  polygon: "https://polygonscan.com",
};

const UPGRADE_URL = "https://tel3.telcoin.network/upgrade";

const PRIMARY = "rounded-lg bg-ocean-gradient px-4 py-2 text-sm font-bold text-white hover-lift disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY = "rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-navy/50 disabled:cursor-not-allowed disabled:opacity-50";

const sourceLabel = (row: ClaimRow) => (row.kind === "merkl" ? "TELx rewards (Merkl)" : "Old pools (legacy TEL)");
const amountLabel = (row: ClaimRow, amount = row.amountTel) =>
  row.kind === "merkl" ? formatTel(amount) : formatTel(amount).replace(" TEL", " legacy TEL");

function TxLink({ row, hash, children }: { row: ClaimRow; hash: Hash; children: React.ReactNode }) {
  return (
    <a href={`${EXPLORERS[row.chain]}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="link">
      {children}
    </a>
  );
}

/** What a row's status says, for the row and for the live region. */
export function statusText(row: ClaimRow, status: ClaimRowStatus | undefined): string {
  const chain = chainDisplayName(row.chain);
  switch (status?.state) {
    case undefined:
    case "waiting":
      return "Waiting";
    case "switching":
      return `Approve the switch to ${chain} in your wallet`;
    case "manualSwitch":
      return `Switch your wallet to ${chain}. The claim continues once it's on ${chain}.`;
    case "preparing":
      return `Checking the latest amount on ${chain}`;
    case "confirm":
      return `Confirm the claim on ${chain} in your wallet`;
    case "confirming":
      return `Confirming on ${chain}`;
    case "claimed":
      return `Claimed ${amountLabel(row, status.amountTel)} on ${chain}`;
    case "skipped":
      return `Skipped: ${status.reason}`;
    case "failed":
      return status.reason;
  }
}

function RowStatus({ row, status }: { row: ClaimRow; status: ClaimRowStatus | undefined }) {
  const tone =
    status?.state === "claimed" ? "text-green-400" : status?.state === "failed" ? "text-red-400" : status?.state === "skipped" ? "text-primary" : "text-white";
  const hash = status && "hash" in status ? status.hash : undefined;
  return (
    <p className={`text-xs ${tone}`}>
      {statusText(row, status)}
      {hash ? (
        <>
          {" "}
          <TxLink row={row} hash={hash}>
            View transaction
          </TxLink>
        </>
      ) : null}
    </p>
  );
}

/**
 * The Claim all panel: the plan of claims across chains to review, then each claim's progress as it runs. It is a
 * modal dialog, so focus stays inside it and Escape closes it; closing during a run stops after the current claim.
 */
export default function ClaimAllDialog({ claimAll }: { claimAll: ClaimAll }) {
  const { phase, rows, statuses, result, toggle, start, decide, close } = claimAll;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isOpen = phase !== "closed";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!isOpen && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [isOpen]);

  const checked = rows.filter((row) => row.checked);
  const running = phase === "running" || phase === "paused";
  const shownRows = phase === "review" ? rows : checked;
  const failedRow = phase === "paused" ? checked.find((row) => statuses[row.id]?.state === "failed") : undefined;
  const liveRow = [...checked].reverse().find((row) => statuses[row.id] && statuses[row.id]?.state !== "waiting");
  const claimedTel = result?.claimed.filter(({ row }) => row.kind === "merkl").reduce((sum, { amountTel }) => sum + amountTel, 0) ?? 0;
  const claimedLegacy = result?.claimed.filter(({ row }) => row.kind === "oldPools").reduce((sum, { amountTel }) => sum + amountTel, 0) ?? 0;
  const claimedChains = new Set(result?.claimed.map(({ row }) => row.chain)).size;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="claim-all-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto w-[min(100vw-2rem,34rem)] rounded-2xl border border-popover-border bg-popover p-0 text-white shadow-2xl backdrop:bg-black/60"
    >
      {isOpen && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="claim-all-title" className="text-lg font-bold">
              {phase === "done" ? "Claims finished" : "Claim your TEL"}
            </h2>
            <button type="button" onClick={close} className="rounded-md px-2 text-xl leading-none text-primary hover:text-white" aria-label="Close">
              ×
            </button>
          </div>

          {phase === "preparing" ? (
            <p className="text-sm text-primary" role="status">
              Checking each chain&apos;s latest amounts and network fees…
            </p>
          ) : (
            <>
              {phase === "review" && (
                <p className="text-sm text-primary">
                  Each chain is a separate claim, so the wallet asks once per chain and switches network between them.
                  Claims run one at a time, starting with the network the wallet is on.
                </p>
              )}

              <ul className="flex flex-col gap-2">
                {shownRows.map((row) => (
                  <li key={row.id} className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center gap-3">
                      {phase === "review" && (
                        <input
                          type="checkbox"
                          checked={row.checked}
                          onChange={() => toggle(row.id)}
                          aria-label={`Claim ${amountLabel(row)} on ${chainDisplayName(row.chain)}`}
                          className="h-4 w-4 accent-accent"
                        />
                      )}
                      <ChainLogo chain={row.chain} size={22} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium">{chainDisplayName(row.chain)}</span>
                        <span className="text-xs text-primary">{sourceLabel(row)}</span>
                      </div>
                      <div className="flex flex-col items-end text-right">
                        <span className="text-sm">{amountLabel(row)}</span>
                        {row.valueUsd !== null && <span className="text-xs text-primary">{formatUsd(row.valueUsd)}</span>}
                      </div>
                    </div>
                    {phase === "review" ? (
                      <div className="flex flex-col gap-0.5 pl-7 text-xs text-primary">
                        <span>{row.feeUsd !== null ? `Network fee about ${formatUsd(row.feeUsd)}` : "Network fee unknown"}</span>
                        {row.uneconomic && <span className="text-amber-400">Costs more in fees than it&apos;s worth, so it starts unchecked.</span>}
                        {row.kind === "oldPools" && (
                          <span>
                            Legacy TEL, which can then be upgraded to TEL3 on the{" "}
                            <a href={UPGRADE_URL} target="_blank" rel="noopener noreferrer" className="link">
                              official upgrade site
                            </a>
                            .
                          </span>
                        )}
                      </div>
                    ) : (
                      <RowStatus row={row} status={statuses[row.id]} />
                    )}
                  </li>
                ))}
              </ul>

              <p className="sr-only" aria-live="polite">
                {liveRow ? statusText(liveRow, statuses[liveRow.id]) : ""}
              </p>

              {phase === "done" && result && (
                <p className="text-sm" role="status">
                  {result.claimed.length === 0
                    ? "Nothing was claimed."
                    : `Claimed ${[claimedTel ? formatTel(claimedTel) : null, claimedLegacy ? formatTel(claimedLegacy).replace(" TEL", " legacy TEL") : null]
                        .filter(Boolean)
                        .join(" and ")} on ${claimedChains} chain${claimedChains === 1 ? "" : "s"}.`}
                  {result.stopped ? " The rest were stopped." : ""}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                {phase === "review" && (
                  <>
                    <button type="button" className={SECONDARY} onClick={close}>
                      Cancel
                    </button>
                    <button type="button" className={PRIMARY} disabled={checked.length === 0} onClick={() => void start()}>
                      {checked.length > 1 ? `Claim ${checked.length}` : "Claim"}
                    </button>
                  </>
                )}
                {failedRow && (
                  <>
                    <button type="button" className={SECONDARY} onClick={() => decide("stop")}>
                      Stop
                    </button>
                    <button type="button" className={SECONDARY} onClick={() => decide("skip")}>
                      Skip
                    </button>
                    <button type="button" className={PRIMARY} onClick={() => decide("retry")}>
                      Try again
                    </button>
                  </>
                )}
                {running && !failedRow && (
                  <button type="button" className={SECONDARY} onClick={close}>
                    Stop after this claim
                  </button>
                )}
                {phase === "done" && (
                  <button type="button" className={PRIMARY} onClick={close}>
                    Done
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
