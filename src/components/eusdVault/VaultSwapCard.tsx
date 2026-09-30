import React from "react";
import type { Address } from "viem";
import { VAULT_DECIMALS, VAULT_DEPLOYMENTS, routeFor } from "@/web3/eusdVault/deployments";
import { formatAmount } from "@/web3/eusdVault/format";
import type { SwapDirection, VaultChainId, VaultView } from "@/web3/eusdVault/types";
import { VaultActions } from "./VaultActions";
import { VaultAmountInput } from "./VaultAmountInput";
import { VaultCard } from "./VaultCard";
import { VaultDirectionToggle } from "./VaultDirectionToggle";
import { VaultNetworkSelector } from "./VaultNetworkSelector";
import { VaultStats } from "./VaultStats";
import { VaultTokenPanel } from "./VaultTokenPanel";

/**
 * Fully controlled: the page owns the chain, the direction, the amount text and every label. The labels describe
 * the direction the card displays, which is `view.formOverride?.direction ?? direction`.
 */
export type VaultSwapCardProps = Readonly<{
  chainIds: readonly VaultChainId[];
  selectedChainId: VaultChainId;
  onSelectChain(chainId: VaultChainId): void;
  /** Disables only the network selector. */
  networkDisabled?: boolean;
  direction: SwapDirection;
  onDirectionChange(next: SwapDirection): void;
  amountText: string;
  onAmountChange(text: string): void;
  onMax(): void;
  maxDisabled?: boolean;
  amountInvalid?: boolean;
  /** Undefined shows "—" (no wallet, or not read yet). */
  balanceInLabel?: string;
  balanceOutLabel?: string;
  /** The quoted output, already formatted. Undefined shows a placeholder. */
  amountOutLabel?: string;
  /** Already formatted with its symbol, e.g. "0 eUSD". */
  feeLabel?: string;
  /** The output reserve, already formatted, without the symbol. */
  liquidityLabel?: string;
  /** The vault, shown as "Approval spender". */
  spender: Address;
  view: VaultView;
  onApprove(): void;
  onSwap(): void;
  onSwitchNetwork(): void;
  onDismiss(): void;
  onRefresh(): void;
  onDone(): void;
  className?: string;
}>;

const QUOTE_CLASS =
  "min-w-0 w-full cursor-default bg-transparent text-right text-2xl text-ellipsis text-white outline-none placeholder:text-white/30 sm:text-3xl";

/** The portal's left card: network row, From panel, direction toggle, To panel, stats, then the actions. */
export function VaultSwapCard({
  chainIds,
  selectedChainId,
  onSelectChain,
  networkDisabled = false,
  direction,
  onDirectionChange,
  amountText,
  onAmountChange,
  onMax,
  maxDisabled = false,
  amountInvalid = false,
  balanceInLabel,
  balanceOutLabel,
  amountOutLabel,
  feeLabel,
  liquidityLabel,
  spender,
  view,
  onApprove,
  onSwap,
  onSwitchNetwork,
  onDismiss,
  onRefresh,
  onDone,
  className,
}: VaultSwapCardProps) {
  const override = view.formOverride;
  // An override only exists while the form is locked; lock on it anyway so the shown amount can never be edited.
  const locked = view.lockForm || override !== undefined;
  const shownDirection = override?.direction ?? direction;
  const shownAmount = override ? formatAmount(override.amountIn, VAULT_DECIMALS) : amountText;
  const { symbolIn, symbolOut } = routeFor(VAULT_DEPLOYMENTS[selectedChainId], shownDirection);

  return (
    <VaultCard className={className}>
      <VaultNetworkSelector
        chainIds={chainIds}
        selectedChainId={selectedChainId}
        onSelect={onSelectChain}
        disabled={locked || networkDisabled}
      />

      <div className="flex flex-col gap-1">
        <VaultTokenPanel label="From" symbol={symbolIn} balanceLabel={balanceInLabel}>
          <VaultAmountInput
            value={shownAmount}
            onChange={onAmountChange}
            onMax={onMax}
            symbol={symbolIn}
            disabled={locked}
            invalid={!override && amountInvalid}
            maxDisabled={maxDisabled}
          />
        </VaultTokenPanel>

        <VaultDirectionToggle direction={shownDirection} onChange={onDirectionChange} disabled={locked} />

        <VaultTokenPanel label="To" symbol={symbolOut} balanceLabel={balanceOutLabel}>
          <input
            type="text"
            readOnly
            tabIndex={-1}
            placeholder="0.0"
            aria-label={`Amount of ${symbolOut} to receive`}
            value={amountOutLabel ?? ""}
            className={QUOTE_CLASS}
          />
        </VaultTokenPanel>
      </div>

      <div className="flex flex-col gap-4">
        <VaultStats feeLabel={feeLabel} liquidityLabel={liquidityLabel} symbolOut={symbolOut} spender={spender} />
        <VaultActions
          view={view}
          onApprove={onApprove}
          onSwap={onSwap}
          onSwitchNetwork={onSwitchNetwork}
          onDismiss={onDismiss}
          onRefresh={onRefresh}
          onDone={onDone}
        />
      </div>
    </VaultCard>
  );
}
