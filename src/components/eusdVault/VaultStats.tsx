import React from "react";
import type { Address } from "viem";
import type { SwapRoute } from "@/web3/eusdVault/types";

export type VaultStatsProps = {
  /** Already formatted with its symbol, e.g. "0 eUSD". */
  feeLabel?: string;
  /** The output reserve, already formatted, without the symbol. */
  liquidityLabel?: string;
  symbolOut: SwapRoute["symbolOut"];
  /** The vault address the approval goes to. Shown only when given. */
  spender?: Address;
};

export function VaultStats({ feeLabel, liquidityLabel, symbolOut, spender }: VaultStatsProps) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-white/60">Fee</dt>
          <dd className="text-right">{feeLabel ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-white/60">Vault liquidity</dt>
          <dd className="text-right">{liquidityLabel === undefined ? "—" : `${liquidityLabel} ${symbolOut}`}</dd>
        </div>
      </dl>
      {spender ? (
        <p className="break-all text-xs text-white/70">
          Approval spender: <span className="font-mono">{spender}</span>
        </p>
      ) : null}
    </div>
  );
}
