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

export function VaultTokenPanel({ label, symbol, balanceLabel, children }: VaultTokenPanelProps) {
  return (
    <div className="border border-[#4967FF] bg-black/40 p-4 rounded-2xl flex flex-col gap-4">
      <p className="text-lg">{label}</p>

      <div className="flex justify-between gap-4 items-center w-full">
        <div className="flex shrink-0 gap-4 items-center">
          <Image className="w-8 h-8" src={TOKEN_ICONS[symbol]} alt={symbol} width={32} height={32} priority />
          <p className="text-base">{symbol}</p>
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-end text-right">
          {children}
          <p className="text-sm text-white/60 mt-1">Balance: {balanceLabel ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}
