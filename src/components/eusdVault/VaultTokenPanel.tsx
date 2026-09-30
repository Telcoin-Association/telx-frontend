import React from "react";
import Image from "next/image";
import type { SwapRoute } from "@/web3/eusdVault/types";

export type VaultTokenPanelProps = {
  label: "From" | "To";
  symbol: SwapRoute["symbolIn"];
  /** Already formatted. Shows "—" when undefined (no wallet, or not read yet). */
  balanceLabel?: string;
  /** The amount area: the input in the From panel, the quoted amount in the To panel. */
  children?: React.ReactNode;
};

const TOKEN_ICONS: Readonly<Record<SwapRoute["symbolIn"], string>> = {
  USDC: "/coins/usdc.png",
  eUSD: "/coins/eUSD.png",
};

/**
 * From `sm` up: the label, then the token beside the amount. Below `sm` the token moves up beside the label so the
 * amount gets the panel's full width; beside the token it would show only a few digits on a phone.
 */
export function VaultTokenPanel({ label, symbol, balanceLabel, children }: VaultTokenPanelProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border border-[#4967FF] bg-black/40 p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
      <p className="text-lg sm:col-span-2">{label}</p>

      <div className="flex items-center gap-2 sm:gap-4">
        <Image className="w-8 h-8" src={TOKEN_ICONS[symbol]} alt={symbol} width={32} height={32} priority />
        <p className="text-base">{symbol}</p>
      </div>

      <div className="col-span-2 flex min-w-0 flex-col items-end text-right sm:col-span-1">
        {children}
        <p className="text-sm text-white/60 mt-1">Balance: {balanceLabel ?? "—"}</p>
      </div>
    </div>
  );
}
