import React from "react";
import ChainLogo from "@/components/common/ChainLogo";
import { VAULT_DEPLOYMENTS } from "@/web3/eusdVault/deployments";
import type { VaultChainId, VaultDeployment } from "@/web3/eusdVault/types";
import { FOCUS_OUTLINE_CLASS } from "./focusOutline";

export type VaultNetworkSelectorProps = {
  chainIds: readonly VaultChainId[];
  selectedChainId: VaultChainId;
  onSelect(chainId: VaultChainId): void;
  disabled?: boolean;
};

const CHAIN_NAMES: Readonly<Record<VaultDeployment["chainKey"], string>> = {
  ethereum: "Ethereum",
  polygon: "Polygon",
  base: "Base",
};

const BUTTON_CLASS = {
  selected: `flex flex-col items-center justify-center gap-1 rounded-xl border border-[#4967FF] bg-[#4967FF]/20 px-2 py-2 text-xs font-semibold text-white sm:flex-row sm:gap-2 sm:px-3 sm:text-sm ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:opacity-50`,
  idle: `flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-[#4967FF]/60 bg-black/40 px-2 py-2 text-xs text-white/80 transition hover:border-[#4967FF] hover:text-white sm:flex-row sm:gap-2 sm:px-3 sm:text-sm ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#4967FF]/60 disabled:hover:text-white/80`,
} as const;

export function VaultNetworkSelector({ chainIds, selectedChainId, onSelect, disabled = false }: VaultNetworkSelectorProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-[#4967FF] bg-black/40 px-4 py-3 rounded-2xl">
      <p>Network:</p>
      <div role="group" aria-label="Network" className="grid grid-cols-3 gap-2 sm:flex">
        {chainIds.map((chainId) => {
          const chainKey = VAULT_DEPLOYMENTS[chainId].chainKey;
          const selected = chainId === selectedChainId;
          return (
            <button
              key={chainId}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => {
                if (disabled || selected) return;
                onSelect(chainId);
              }}
              className={selected ? BUTTON_CLASS.selected : BUTTON_CLASS.idle}
            >
              <span aria-hidden="true" className="flex shrink-0">
                <ChainLogo chain={chainKey} size={20} className="rounded-full" />
              </span>
              <span>{CHAIN_NAMES[chainKey]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
