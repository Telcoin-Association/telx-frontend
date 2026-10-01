"use client";

import React from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { POLYGON_USDCE, POLYGON_USDCE_DECIMALS, vaultPair } from "@/web3/swap/tokens";

const USDCE_BY_CHAIN = { polygon: POLYGON_USDCE } as const;
/** Balances below one cent of USDC.e are dust, not worth a swap's gas. */
const DUST_UNITS = 10_000n;

const formatUsdce = (amount: string) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(amount));

/** The /swap link that converts `amount` (whole USDC.e) to native USDC on Polygon. */
export function usdceSwapHref(amount: string): string {
  const params = new URLSearchParams({ chain: "polygon", sell: POLYGON_USDCE, buy: vaultPair("polygon").usdc, amount });
  return `/swap?${params}`;
}

const LINK = "w-fit text-sm font-bold text-blue-700 underline underline-offset-4 hover:text-white";

/**
 * Points a wallet holding Polygon's bridged USDC.e, which the old TELx pools paired with, to /swap prefilled to
 * convert all of it to native USDC. Native USDC is what the eUSD vault takes, so the second action carries the same
 * prefill with a note that eUSD then comes from the vault 1:1. Hidden when the wallet holds no more than dust, or the
 * balance can't be read.
 */
export default function UsdceConvertCard() {
  const { address } = useAccount();
  const { balances } = useTokenBalances(address, USDCE_BY_CHAIN);
  const held = balances.polygon ?? 0n;
  if (held < DUST_UNITS) return null;

  const amount = formatUnits(held, POLYGON_USDCE_DECIMALS);
  const href = usdceSwapHref(amount);
  return (
    <section aria-label="Convert USDC.e" className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
      <p>You hold {formatUsdce(amount)} USDC.e on Polygon, the bridged USDC the old pools used. The current pools and the eUSD vault use native USDC.</p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Link href={href} className={LINK}>
          Convert {formatUsdce(amount)} USDC.e to USDC
        </Link>
        <Link href={href} className={LINK}>
          Convert to USDC for eUSD
        </Link>
      </div>
      <p className="text-xs text-primary">
        For eUSD, convert to USDC first, then swap USDC for eUSD 1:1 in the{" "}
        <Link href="/eusd-vault" className="underline">
          eUSD vault
        </Link>
        .
      </p>
    </section>
  );
}
