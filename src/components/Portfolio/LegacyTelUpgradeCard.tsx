"use client";

import React from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { formatTel } from "@/lib/portfolioSummary";
import { LEGACY_TEL_BY_CHAIN, LEGACY_TEL_DECIMALS, TEL_UPGRADE_HOST, TEL_UPGRADE_URL } from "@/lib/tokens";

const legacyAmount = (amount: number) => formatTel(amount).replace(" TEL", " legacy TEL");

/**
 * Points a wallet holding legacy TEL, or with legacy TEL rewards still to claim, to the official upgrade site.
 * Holdings are read on Ethereum, Polygon and Base; a chain whose read fails is left out of the total. Hidden when
 * the wallet holds none and has none to claim.
 */
export default function LegacyTelUpgradeCard({ legacyClaimableTel }: { legacyClaimableTel: number | null }) {
  const { address } = useAccount();
  const { balances } = useTokenBalances(address, LEGACY_TEL_BY_CHAIN);

  const heldUnits = Object.values(balances).reduce<bigint>((sum, balance) => sum + (balance ?? 0n), 0n);
  const held = Number(formatUnits(heldUnits, LEGACY_TEL_DECIMALS));
  const claimable = legacyClaimableTel ?? 0;
  if (held <= 0 && claimable <= 0) return null;

  return (
    <section aria-label="Upgrade legacy TEL" className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
      {held > 0 ? (
        <p>You hold {legacyAmount(held)}. Upgrade it to TEL3 on the official upgrade site.</p>
      ) : (
        <p>You have {legacyAmount(claimable)} to claim from old pools. Once claimed, upgrade it to TEL3 on the official upgrade site.</p>
      )}
      {held > 0 && claimable > 0 && <p className="text-xs text-primary">The {legacyAmount(claimable)} still to claim below can be upgraded the same way once claimed.</p>}
      <a href={TEL_UPGRADE_URL} target="_blank" rel="noopener noreferrer" className="w-fit text-sm font-bold text-blue-700 underline underline-offset-4 hover:text-white">
        Upgrade on {TEL_UPGRADE_HOST}
      </a>
    </section>
  );
}
