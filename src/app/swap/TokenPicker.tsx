import React from "react";
import Image from "next/image";
import type { SwapToken } from "@/web3/swap/tokens";

/** A listed token's logo. Tokens added by address have none and show the symbol alone. */
export function TokenIcon({ token, size = 20 }: { token: SwapToken | undefined; size?: number }) {
  if (!token?.icon) return null;
  return <Image src={token.icon} alt="" width={size} height={size} className="shrink-0 rounded-full" data-testid={`token-icon-${token.symbol}`} />;
}

type TokenPickerProps = {
  id: string;
  label: string;
  value: string;
  options: readonly SwapToken[];
  token: SwapToken | undefined;
  onChange: (address: string) => void;
  disabled?: boolean;
};

/**
 * A token picker drawn as a pill: logo, symbol, a gap, then the chevron. The native select lies transparent over
 * the pill, so the keyboard, screen readers and the platform's option list behave as with any select, while the
 * spacing no longer depends on how each browser pads a select's label and arrow.
 */
export function TokenPicker({ id, label, value, options, token, onChange, disabled }: TokenPickerProps) {
  return (
    <div
      data-testid={`${id}-picker`}
      className="relative shrink-0 rounded-full border border-white/10 bg-black/40 transition-colors hover:border-accent-light/60 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus has-[select:disabled]:opacity-60"
    >
      <div aria-hidden="true" data-testid={`${id}-face`} className="pointer-events-none flex items-center gap-2 py-1.5 pl-1.5 pr-3">
        {token?.icon ? <TokenIcon token={token} size={24} /> : <span className="w-0.5" />}
        <span data-testid={`${id}-symbol`} className="max-w-[7.5rem] truncate font-bold text-white">{token?.symbol ?? "Select"}</span>
        <svg data-testid={`${id}-chevron`} viewBox="0 0 24 24" className="ml-1 h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
      >
        {options.map((option) => (
          <option key={option.address} value={option.address}>
            {option.symbol}
          </option>
        ))}
      </select>
    </div>
  );
}
