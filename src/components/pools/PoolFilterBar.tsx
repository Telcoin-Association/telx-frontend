"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { getAssetImage } from "@/components/pool/PoolWeightChip";
import { chainDisplayName } from "@/lib/poolTitle";
import { POOL_CHAIN_FILTERS, type PoolChainFilter } from "@/lib/poolOrder";
import type { TokenOption } from "@/lib/poolTokenFilter";

export const CHIP = "cursor-pointer rounded-full border px-3 py-2 text-xs transition duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
export const CHIP_ACTIVE = "border-accent bg-accent font-bold text-white";
export const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";

const chipLabel = (chain: PoolChainFilter) => (chain === "all" ? "All" : chainDisplayName(chain));

type PoolFilterBarProps = {
  /** Names the list in labels, for example "pools" or "archived pools". */
  listName: string;
  query: string;
  onQueryChange: (query: string) => void;
  tokenOptions: readonly TokenOption[];
  selectedTokens: readonly string[];
  onSelectedTokensChange: (tokens: string[]) => void;
  matchAll: boolean;
  onMatchAllChange: (matchAll: boolean) => void;
  chain: PoolChainFilter;
  onChainChange: (chain: PoolChainFilter) => void;
  chainCounts: Record<PoolChainFilter, number>;
  /** Further toggles shown at the end of the bar. */
  children?: React.ReactNode;
};

/** The filter bar above a pool list: token search, chain chips, a Tokens checklist and any further toggles. */
export default function PoolFilterBar(props: PoolFilterBarProps) {
  const { listName, query, onQueryChange, chain, onChainChange, chainCounts, children } = props;
  const searchId = useId();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full sm:w-64">
        <label htmlFor={searchId} className="sr-only">
          Search {listName} by token
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by token"
          autoComplete="off"
          className="w-full rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-white transition-colors placeholder:text-primary/70 hover:border-accent-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
      </div>
      <div role="group" aria-label={`Filter ${listName} by chain`} className="flex flex-wrap gap-2">
        {POOL_CHAIN_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={chain === option}
            onClick={() => onChainChange(option)}
            className={`${CHIP} ${chain === option ? CHIP_ACTIVE : CHIP_IDLE}`}
          >
            {chipLabel(option)} <span className="font-bold">({chainCounts[option]})</span>
          </button>
        ))}
      </div>
      <TokenChecklist {...props} />
      {children}
    </div>
  );
}

function TokenChecklist({ listName, tokenOptions, selectedTokens, onSelectedTokensChange, matchAll, onMatchAllChange }: PoolFilterBarProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  const toggle = (key: string) =>
    onSelectedTokensChange(selectedTokens.includes(key) ? selectedTokens.filter((token) => token !== key) : [...selectedTokens, key]);

  const selected = selectedTokens.length;

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`select-chevron ${CHIP} pr-9 ${selected > 0 ? CHIP_ACTIVE : CHIP_IDLE}`}
      >
        Tokens{selected > 0 ? ` (${selected})` : ""}
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={`Filter ${listName} by token`}
          className="absolute left-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-popover-border bg-popover/95 p-2 shadow-2xl backdrop-blur"
        >
          {tokenOptions.length === 0 ? (
            <p className="px-2 py-1 text-sm text-primary">No tokens to filter by.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {tokenOptions.map((option) => {
                const image = getAssetImage({ ticker: option.ticker });
                const checked = selectedTokens.includes(option.key);
                return (
                  <li key={option.key}>
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white transition-colors hover:bg-white/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${checked ? "bg-popover-selected" : ""}`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(option.key)} className="h-4 w-4 accent-accent" />
                      {image ? <Image src={image} alt="" width={18} height={18} /> : <span aria-hidden="true" className="h-[18px] w-[18px] rounded-full bg-white/10" />}
                      <span className="flex-1 font-bold">{option.label}</span>
                      <span className="text-xs text-primary">{option.count}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 px-2 pt-2">
            <label className={`flex items-center gap-2 text-xs ${selected > 1 ? "cursor-pointer text-white" : "text-primary/60"}`}>
              <input
                type="checkbox"
                checked={matchAll}
                disabled={selected < 2}
                onChange={(event) => onMatchAllChange(event.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Match all
            </label>
            <button
              type="button"
              disabled={selected === 0}
              onClick={() => onSelectedTokensChange([])}
              className="cursor-pointer rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear selection
            </button>
          </div>
          <p className="px-2 pt-1 text-[11px] text-primary/80">
            {matchAll && selected > 1 ? "Showing pools with every selected token." : "Showing pools with any selected token."}
          </p>
        </div>
      )}
    </div>
  );
}
