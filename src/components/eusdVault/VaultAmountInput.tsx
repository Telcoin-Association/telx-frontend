import React from "react";
import { sanitizeAmountInput } from "@/web3/eusdVault/amount";
import type { SwapRoute } from "@/web3/eusdVault/types";

export type VaultAmountInputProps = {
  /** The raw amount text the page owns. Shown as is: never parsed or rounded here. */
  value: string;
  onChange(text: string): void;
  onMax(): void;
  symbol: SwapRoute["symbolIn"];
  disabled?: boolean;
  invalid?: boolean;
  maxDisabled?: boolean;
  id?: string;
};

const INPUT_CLASS = {
  valid:
    "min-w-0 w-full bg-transparent text-right text-3xl text-white outline-none placeholder:text-white/30 disabled:cursor-not-allowed disabled:text-white/40",
  invalid:
    "min-w-0 w-full bg-transparent text-right text-3xl text-status-error outline-none placeholder:text-white/30 disabled:cursor-not-allowed disabled:text-white/40",
} as const;

export function VaultAmountInput({
  value,
  onChange,
  onMax,
  symbol,
  disabled = false,
  invalid = false,
  maxDisabled = false,
  id,
}: VaultAmountInputProps) {
  const maxBlocked = disabled || maxDisabled;
  return (
    <div className="flex w-full min-w-0 items-center gap-2 rounded-lg focus-within:ring-2 focus-within:ring-[#4967FF]/40">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="0.0"
        aria-label={`Amount of ${symbol} to swap`}
        aria-invalid={invalid ? true : undefined}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (disabled) return;
          onChange(sanitizeAmountInput(event.target.value));
        }}
        className={invalid ? INPUT_CLASS.invalid : INPUT_CLASS.valid}
      />
      <button
        type="button"
        disabled={maxBlocked}
        onClick={() => {
          if (maxBlocked) return;
          onMax();
        }}
        className="shrink-0 cursor-pointer rounded-lg border-[0.70px] border-tblue-700 bg-black/10 px-2 py-1 text-xs font-bold text-tblue-700 hover:bg-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4967FF]/40 disabled:cursor-not-allowed disabled:border-white/20 disabled:text-white/30 disabled:hover:bg-black/10"
      >
        MAX
      </button>
    </div>
  );
}
