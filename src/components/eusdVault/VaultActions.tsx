import React from "react";
import { CustomConnectButton } from "@/components/layout/CustomConnectButton";
import type { VaultView } from "@/web3/eusdVault/types";
import { FOCUS_OUTLINE_CLASS } from "./focusOutline";
import { VaultNotice } from "./VaultNotice";

export type VaultActionsProps = Readonly<{
  view: VaultView;
  onApprove: () => void;
  onSwap: () => void;
  onSwitchNetwork: () => void;
  onDismiss: () => void;
  onRefresh: () => void;
  onDone: () => void;
}>;

type PrimaryAction = VaultView["primary"]["action"];

// The shared Button's primary and secondary classes. The step buttons are plain buttons because Button nests an
// `<a>` inside its `<button>`. The disabled label is brighter than Button's, because it is often the only place that
// says why the form is blocked ("Insufficient USDC balance").
const PRIMARY_CLASS = `flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-ocean-gradient px-4 py-3 text-sm font-bold text-white duration-200 hover-lift ${FOCUS_OUTLINE_CLASS}`;
const PRIMARY_DISABLED_CLASS =
  "flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-black/30 px-4 py-3 text-sm font-bold text-white/50";
const SECONDARY_CLASS = `flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-[0.70px] border-tblue-700 bg-black/10 px-4 py-3 text-sm font-bold text-white duration-200 hover-lift hover:bg-black/20 ${FOCUS_OUTLINE_CLASS}`;
const LINK_CLASS = "text-center text-sm text-tblue-700 underline";

function CompleteIcon() {
  return (
    <span className="rounded-full bg-status-complete p-2" aria-hidden="true">
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none">
        <path d="M4.5 10.5 8.5 14.5 15.5 6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function SuccessCard({ success }: Readonly<{ success: NonNullable<VaultView["success"]> }>) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-status-complete bg-black/40 p-4 text-center text-sm text-primary">
      <CompleteIcon />
      <p className="text-base font-bold text-white">
        You received {success.amountOutLabel} {success.symbolOut} on {success.chainName}.
      </p>
      {success.feeLabel ? (
        <p>
          Vault fee: {success.feeLabel} {success.symbolOut}
        </p>
      ) : null}
      {success.href ? (
        <a href={success.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          View transaction
        </a>
      ) : null}
    </div>
  );
}

/** Everything below the swap form: the notice, the success card or the step buttons, and the secondary actions. */
export function VaultActions({ view, onApprove, onSwap, onSwitchNetwork, onDismiss, onRefresh, onDone }: VaultActionsProps) {
  const { primary } = view;
  // "connect" has no handler here: that state renders the connect button instead.
  const primaryHandlers: Partial<Record<NonNullable<PrimaryAction>, () => void>> = {
    approve: onApprove,
    swap: onSwap,
    "switch-network": onSwitchNetwork,
  };
  const primaryHandler = primary.action ? primaryHandlers[primary.action] : undefined;
  const secondaryHandlers = { dismiss: onDismiss, refresh: onRefresh, done: onDone } as const;

  const handlePrimary = () => {
    if (primary.disabled) return;
    primaryHandler?.();
  };

  const { notice, success } = view;
  const isError = notice?.tone === "error";

  return (
    <div className="flex w-full flex-col gap-4">
      {notice && isError ? <VaultNotice notice={notice} /> : null}
      {/* Mounted even when empty, so a screen reader is already watching it when a notice or the success card
          arrives. `empty:-mb-4` cancels the flex gap of the empty slot. */}
      <div role="status" aria-live="polite" className="flex flex-col gap-4 empty:-mb-4">
        {notice && !isError ? <VaultNotice notice={notice} /> : null}
        {success ? <SuccessCard success={success} /> : null}
      </div>

      {success ? null : primary.kind === "connect" ? (
        <div className="flex justify-center">
          <CustomConnectButton />
        </div>
      ) : (
        <>
          {view.showStepOneComplete ? (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-black/30 px-4 py-3 text-sm font-bold text-primary">
              <CompleteIcon />
              Step 1 complete
            </div>
          ) : null}
          <button
            type="button"
            className={primary.disabled ? PRIMARY_DISABLED_CLASS : PRIMARY_CLASS}
            disabled={primary.disabled}
            onClick={handlePrimary}
          >
            {primary.label}
          </button>
        </>
      )}

      {view.secondary.map(item => {
        if (item.kind === "explorer") {
          return item.href ? (
            <a key={item.kind} href={item.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
              {item.label}
            </a>
          ) : null;
        }
        return (
          <button key={item.kind} type="button" className={SECONDARY_CLASS} onClick={secondaryHandlers[item.kind]}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
