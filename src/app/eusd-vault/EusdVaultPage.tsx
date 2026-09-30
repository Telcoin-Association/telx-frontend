"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useConfig } from "wagmi";
import { VaultAddressesCard } from "@/components/eusdVault/VaultAddressesCard";
import { VaultSwapCard } from "@/components/eusdVault/VaultSwapCard";
import {
  notifyVaultApprovalConfirmed,
  notifyVaultError,
  notifyVaultSwapConfirmed,
} from "@/components/eusdVault/vaultToasts";
import { useVaultChain } from "@/hooks/useVaultChain";
import { useVaultLifecycle } from "@/hooks/useVaultLifecycle";
import { settleSatisfied, useVaultSettlePolling } from "@/hooks/useVaultSettlePolling";
import { useVaultState } from "@/hooks/useVaultState";
import { chainDisplayName } from "@/lib/poolTitle";
import { maxAmountInput, parseAmountInput } from "@/web3/eusdVault/amount";
import { VAULT_CHAIN_IDS, VAULT_DECIMALS, VAULT_DEPLOYMENTS, routeFor } from "@/web3/eusdVault/deployments";
import { describeError } from "@/web3/eusdVault/errors";
import { formatAmount } from "@/web3/eusdVault/format";
import type { LifecycleFailure, SwapDirection, VaultLiveState, VaultPageState } from "@/web3/eusdVault/types";
import { deriveVaultView, explorerTxUrl } from "@/web3/eusdVault/view";
import { createWagmiVaultDeps } from "@/web3/eusdVault/wagmiAdapter";

const TRANSACTION_FAILED = "The transaction could not be completed.";

const NO_LIVE_STATE: VaultLiveState = { allowances: {} };

type DirectionAmounts = Readonly<{
  balanceIn?: bigint;
  balanceOut?: bigint;
  allowanceIn?: bigint;
  outputReserve?: bigint;
}>;

/** One direction's numbers from the verified read. USDC is the vault's gem: the input of `usdcToEusd`. */
function amountsFor(state: VaultPageState | undefined, direction: SwapDirection): DirectionAmounts {
  if (state === undefined) return {};
  const gemIn = direction === "usdcToEusd";
  const { balances, allowances } = state;
  return {
    balanceIn: balances && (gemIn ? balances.gem : balances.stable),
    balanceOut: balances && (gemIn ? balances.stable : balances.gem),
    allowanceIn: allowances && (gemIn ? allowances.gem : allowances.stable),
    outputReserve: gemIn ? state.stableReserve : state.gemReserve,
  };
}

function amountLabel(value: bigint | undefined): string | undefined {
  return value === undefined ? undefined : formatAmount(value, VAULT_DECIMALS);
}

export default function EusdVaultPage() {
  const config = useConfig();
  const deps = useMemo(() => createWagmiVaultDeps(config), [config]);
  const { address } = useAccount();
  const chain = useVaultChain();
  const { deployment, selectedChainId, isWrongNetwork } = chain;

  const [direction, setDirection] = useState<SwapDirection>("usdcToEusd");
  const [amountText, setAmountText] = useState("");
  // A new chain starts with an empty amount. Adjusted during render, so no read goes out for the old amount.
  const [amountChainId, setAmountChainId] = useState(selectedChainId);
  if (amountChainId !== selectedChainId) {
    setAmountChainId(selectedChainId);
    setAmountText("");
  }
  const amount = parseAmountInput(amountText, VAULT_DECIMALS);
  const parsedAmount = amount.status === "valid" ? amount.value : undefined;

  // On a wrong network the page reads the selected chain as if no wallet were connected.
  const owner = isWrongNetwork ? undefined : address;
  const vault = useVaultState({
    deployment,
    direction,
    owner,
    amountIn: parsedAmount !== undefined && parsedAmount > 0n ? parsedAmount : undefined,
    source: deps.appSource(selectedChainId),
  });
  const { state, updatedAt, quote, refetch } = vault;

  const live = useMemo<VaultLiveState>(() => {
    const allowances = owner === undefined ? undefined : state?.allowances;
    if (allowances === undefined) return NO_LIVE_STATE;
    return {
      allowances: {
        usdcToEusd: { value: allowances.gem, updatedAt },
        eusdToUsdc: { value: allowances.stable, updatedAt },
      },
    };
  }, [owner, state, updatedAt]);

  const lifecycle = useVaultLifecycle({ live }, deps);
  const lifecycleState = lifecycle.state;
  const { status, kind, completed, failure } = lifecycleState;

  const onSettled = () => {
    lifecycle.acknowledge();
    const settledDirection = lifecycleState.direction ?? direction;
    if (kind === "approve") {
      notifyVaultApprovalConfirmed({ symbol: routeFor(deployment, settledDirection).symbolIn });
      return;
    }
    if (completed) {
      const completedDeployment = VAULT_DEPLOYMENTS[completed.chainId];
      notifyVaultSwapConfirmed({
        amountOutLabel: formatAmount(completed.amountOut, VAULT_DECIMALS),
        symbolOut: routeFor(completedDeployment, completed.direction).symbolOut,
        href: explorerTxUrl(completedDeployment.explorerUrl, completed.transactionHash, false),
      });
    }
    setAmountText("");
  };

  // Observed for the transaction's own direction, which the form adopts below.
  const settleAmounts = amountsFor(state, lifecycleState.direction ?? direction);
  const settleTarget = { amountIn: lifecycleState.amountIn, confirmedBlock: lifecycleState.confirmedBlock };
  const { settle, refresh } = useVaultSettlePolling({
    status,
    kind,
    ...settleTarget,
    refetch,
    onSettled,
    observed:
      kind !== undefined &&
      settleSatisfied(kind, { allowanceIn: settleAmounts.allowanceIn, blockNumber: state?.blockNumber }, settleTarget),
  });

  const form = amountsFor(state, direction);
  // The success card names the chain the swap happened on, even after the wallet moved.
  const viewDeployment = completed ? VAULT_DEPLOYMENTS[completed.chainId] : deployment;
  const view = deriveVaultView({
    address,
    isWrongNetwork,
    hasDeployment: true,
    isVerifying: vault.isVerifying,
    isSecurityCheckUnavailable: vault.isSecurityCheckUnavailable,
    isContractVerified: vault.isContractVerified,
    paused: vault.paused,
    direction,
    amount,
    balanceIn: form.balanceIn ?? 0n,
    allowanceIn: form.allowanceIn ?? 0n,
    outputReserve: form.outputReserve ?? 0n,
    maxPerTransaction: state?.maxPerTransaction ?? 0n,
    maxPerBlock: state?.maxPerBlock ?? 0n,
    quote,
    lifecycle: lifecycleState,
    settle,
    chainName: chainDisplayName(viewDeployment.chainKey),
    explorerUrl: viewDeployment.explorerUrl,
    error: vault.error ?? chain.switchError,
  });

  // A transaction in flight (this tab's, another tab's, or one resumed after a reload) owns the form, so every read,
  // label and settle observation is for it. The form never changes a pending record.
  const overrideDirection = view.formOverride?.direction;
  const overrideAmountIn = view.formOverride?.amountIn;
  useEffect(() => {
    if (overrideDirection === undefined || overrideAmountIn === undefined) return;
    if (overrideDirection === direction && overrideAmountIn === parsedAmount) return;
    setDirection(overrideDirection);
    setAmountText(formatUnits(overrideAmountIn, VAULT_DECIMALS));
  }, [overrideDirection, overrideAmountIn, direction, parsedAmount]);

  const reportedFailure = useRef<LifecycleFailure | undefined>(undefined);
  useEffect(() => {
    if (status !== "failed" || failure === undefined || reportedFailure.current === failure) return;
    reportedFailure.current = failure;
    notifyVaultError(describeError(failure.error, TRANSACTION_FAILED));
    // The vault moved since the quote; show its new state rather than wait for the next refresh.
    if (failure.reason === "state-changed" || failure.reason === "providers-disagree") void refetch();
  }, [status, failure, refetch]);

  // Labels describe the direction and amount the card shows, which is the override's while one is set.
  const shownDirection = overrideDirection ?? direction;
  const shownAmountIn = overrideAmountIn ?? parsedAmount;
  const shown = amountsFor(state, shownDirection);
  const { symbolOut } = routeFor(deployment, shownDirection);
  const shownQuote =
    quote.status === "ready" && quote.direction === shownDirection && quote.amountIn === shownAmountIn
      ? quote.quote
      : undefined;

  const onDirectionChange = (next: SwapDirection) => {
    setDirection(next);
    setAmountText("");
  };

  const onMax = () => {
    if (state === undefined || form.balanceIn === undefined) return;
    setAmountText(
      maxAmountInput({
        balanceIn: form.balanceIn,
        maxPerTransaction: state.maxPerTransaction,
        maxPerBlock: state.maxPerBlock,
        outputReserve: form.outputReserve,
        decimals: VAULT_DECIMALS,
      })
    );
  };

  const onApprove = () => {
    if (parsedAmount === undefined || parsedAmount <= 0n) return;
    void lifecycle.approve({ direction, amountIn: parsedAmount });
  };

  // Only the quote shown for exactly this direction and amount may be sent; the vault takes no minimum output.
  const onSwap = () => {
    if (quote.status !== "ready" || quote.direction !== direction || quote.amountIn !== parsedAmount) return;
    void lifecycle.swap({ direction, amountIn: quote.amountIn, quote: quote.quote });
  };

  const onDone = () => {
    lifecycle.done();
    setAmountText("");
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mx-auto mb-16 flex flex-col items-center gap-8 lg:px-16">
        <h1 className="text-center text-4xl font-bold">eUSD Vault</h1>
        <p className="text-center text-lg text-primary">
          Swap USDC and eUSD 1:1 at the bank&apos;s peg-stability vault on Ethereum, Polygon and Base. When the vault
          charges a fee, it comes out of the amount you receive.
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:gap-8">
        <VaultSwapCard
          className="lg:w-[55%]"
          chainIds={VAULT_CHAIN_IDS}
          selectedChainId={selectedChainId}
          onSelectChain={chain.selectChain}
          networkDisabled={chain.isSwitching}
          direction={direction}
          onDirectionChange={onDirectionChange}
          amountText={amountText}
          onAmountChange={setAmountText}
          onMax={onMax}
          maxDisabled={form.balanceIn === undefined || form.balanceIn === 0n}
          amountInvalid={
            amount.status === "invalid" ||
            (parsedAmount !== undefined && form.balanceIn !== undefined && parsedAmount > form.balanceIn)
          }
          balanceInLabel={amountLabel(shown.balanceIn)}
          balanceOutLabel={amountLabel(shown.balanceOut)}
          amountOutLabel={amountLabel(shownQuote?.amountOut)}
          feeLabel={shownQuote ? `${formatAmount(shownQuote.fee, VAULT_DECIMALS)} ${symbolOut}` : undefined}
          liquidityLabel={amountLabel(shown.outputReserve)}
          spender={deployment.vault}
          view={view}
          onApprove={onApprove}
          onSwap={onSwap}
          onSwitchNetwork={() => chain.selectChain(selectedChainId)}
          onDismiss={lifecycle.dismissPending}
          onRefresh={refresh}
          onDone={onDone}
        />
        <VaultAddressesCard className="lg:w-[45%]" deployment={deployment} />
      </div>
    </div>
  );
}
