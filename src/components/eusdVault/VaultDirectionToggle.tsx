import React from "react";
import { directionRoute } from "@/web3/eusdVault/deployments";
import type { SwapDirection } from "@/web3/eusdVault/types";
import { FOCUS_OUTLINE_CLASS } from "./focusOutline";

export type VaultDirectionToggleProps = {
  direction: SwapDirection;
  onChange(next: SwapDirection): void;
  disabled?: boolean;
};

function directionLabel(direction: SwapDirection): string {
  const { symbolIn, symbolOut } = directionRoute(direction);
  return `${symbolIn} to ${symbolOut}`;
}

const REVERSED: Readonly<Record<SwapDirection, SwapDirection>> = {
  usdcToEusd: "eusdToUsdc",
  eusdToUsdc: "usdcToEusd",
};

export function VaultDirectionToggle({ direction, onChange, disabled = false }: VaultDirectionToggleProps) {
  return (
    <div className="flex items-center justify-center relative">
      <div className="z-10 absolute rounded-full bg-[#1A3372]">
        <div className="z-50 border rounded-full border-[#4967FF]">
          <button
            type="button"
            aria-label={`Reverse direction, now ${directionLabel(direction)}`}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              onChange(REVERSED[direction]);
            }}
            className={`mx-auto text-center w-fit p-3 drop-shadow-2xl shadow-2xl rounded-full bg-[#0C1238] border-4 border-[#1A3372] cursor-pointer transition hover:bg-[#1A3372] ${FOCUS_OUTLINE_CLASS} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#0C1238]`}
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
