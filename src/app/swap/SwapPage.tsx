"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { erc20Abi, formatUnits, getAddress, isAddress, type Address, type Hash } from "viem";
import { useAccount, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { VaultCard } from "@/components/eusdVault/VaultCard";
import { VaultNetworkSelector } from "@/components/eusdVault/VaultNetworkSelector";
import { notifyVaultSwapConfirmed } from "@/components/eusdVault/vaultToasts";
import { CustomConnectButton } from "@/components/layout/CustomConnectButton";
import { publicClientBase, publicClientEthereum, publicClientPolygon } from "@/lib/publicClients";
import type { RpcChain } from "@/lib/rpc";
import { isRpcChain } from "@/lib/rpc";
import { formatTokenAmount } from "@/lib/positionView";
import { vaultAbi } from "@/web3/eusdVault/abis";
import { VAULT_CHAIN_IDS, VAULT_DEPLOYMENTS } from "@/web3/eusdVault/deployments";
import { describeError } from "@/web3/eusdVault/errors";
import { fetchQuote, isQuoteFresh, parseSellAmount, QUOTE_REFRESH_MS, type QuoteOutcome } from "@/web3/swap/quote";
import { isNative, listedToken, SWAP_CHAIN_BY_ID, SWAP_CHAIN_IDS, SWAP_TOKENS, vaultPair, type SwapToken } from "@/web3/swap/tokens";

const CLIENTS = { ethereum: publicClientEthereum, polygon: publicClientPolygon, base: publicClientBase } as const;
const CHAIN_NAMES: Record<RpcChain, string> = { ethereum: "Ethereum", polygon: "Polygon", base: "Base" };
/** Polygon sees one-block reorgs routinely, so a receipt waits for a few blocks there, as the eUSD vault does. */
const CONFIRMATIONS: Record<RpcChain, number> = { ethereum: 1, polygon: 3, base: 1 };
const RECEIPT_TIMEOUT_MS = 5 * 60_000;
const SLIPPAGE_OPTIONS_BPS = [10, 50, 100];
const DEFAULT_SLIPPAGE_BPS = 50;
const QUOTE_DEBOUNCE_MS = 400;

const PANEL = "flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/40 p-4";
const FIELD = "rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-tblue-700";
const PRIMARY = "w-full rounded-xl bg-ocean-gradient px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const CHIP = "rounded-full border px-3 py-1 text-xs";

type Step =
  | { kind: "idle" }
  | { kind: "busy"; label: string; hash?: Hash }
  | { kind: "done"; hash: Hash; message: string }
  | { kind: "failed"; message: string; tone: "info" | "warning" | "error"; hash?: Hash };

function initialChain(params: URLSearchParams): RpcChain {
  const chain = params.get("chain") ?? "";
  return isRpcChain(chain) ? chain : "polygon";
}

/**
 * Swaps any token through the 0x Swap API on Ethereum, Polygon or Base. The query string can prefill the form:
 * `chain`, `sell` and `buy` (token addresses) and `amount` (in whole tokens). Quotes come from GET /api/swap/quote,
 * which checks every transaction against 0x's contracts; a quote older than QUOTE_TTL_MS is fetched again before it
 * can be sent. eUSD and native USDC swap 1:1 in the eUSD vault without slippage, so that pair points there while
 * the vault holds enough of the token bought.
 */
export default function SwapPage() {
  const params = useSearchParams();
  const { address, chain: walletChain, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const [chain, setChain] = useState<RpcChain>(() => initialChain(params));
  const [sellAddress, setSellAddress] = useState<string>(() => params.get("sell") ?? vaultPair(initialChain(params)).usdc);
  const [buyAddress, setBuyAddress] = useState<string>(() => params.get("buy") ?? SWAP_TOKENS[initialChain(params)][0].address);
  const [amountText, setAmountText] = useState(() => params.get("amount") ?? "");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [customTokens, setCustomTokens] = useState<Record<string, SwapToken>>({});
  const [customAddress, setCustomAddress] = useState("");
  const [customNote, setCustomNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<QuoteOutcome | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [sellBalance, setSellBalance] = useState<bigint | null>(null);
  const [vaultCovers, setVaultCovers] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const quoteRequestId = useRef(0);
  const amountId = useId();
  const sellId = useId();
  const buyId = useId();
  const customId = useId();

  const client = CLIENTS[chain];
  const chainId = SWAP_CHAIN_IDS[chain];
  const tokenFor = useCallback((tokenAddress: string) => listedToken(chain, tokenAddress) ?? customTokens[`${chain}:${tokenAddress.toLowerCase()}`], [chain, customTokens]);
  const options = useMemo(() => [...SWAP_TOKENS[chain], ...Object.entries(customTokens).filter(([key]) => key.startsWith(`${chain}:`)).map(([, token]) => token)], [chain, customTokens]);
  const sellToken = tokenFor(sellAddress);
  const buyToken = tokenFor(buyAddress);
  const sellAmount = sellToken ? parseSellAmount(amountText, sellToken.decimals) : null;
  const busy = step.kind === "busy";

  // A token named in the query string but not listed is looked up on chain, like a pasted address.
  const resolveToken = useCallback(
    async (tokenAddress: string): Promise<SwapToken | null> => {
      if (!isAddress(tokenAddress, { strict: false })) return null;
      const known = tokenFor(tokenAddress);
      if (known) return known;
      try {
        const checksummed = getAddress(tokenAddress);
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address: checksummed, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address: checksummed, abi: erc20Abi, functionName: "decimals" }),
        ]);
        const token: SwapToken = { address: checksummed, symbol, decimals };
        setCustomTokens((current) => ({ ...current, [`${chain}:${checksummed.toLowerCase()}`]: token }));
        return token;
      } catch {
        return null;
      }
    },
    [chain, client, tokenFor],
  );

  useEffect(() => {
    for (const tokenAddress of [sellAddress, buyAddress]) if (!tokenFor(tokenAddress)) void resolveToken(tokenAddress);
  }, [sellAddress, buyAddress, tokenFor, resolveToken]);

  const quoteKey = sellToken && buyToken && sellAmount ? `${chain}|${sellToken.address}|${buyToken.address}|${sellAmount}|${slippageBps}|${address ?? ""}` : null;

  const loadQuote = useCallback(async () => {
    if (!sellToken || !buyToken || !sellAmount) return null;
    const id = ++quoteRequestId.current;
    setQuoting(true);
    const result = await fetchQuote({ chain, sellToken: sellToken.address, buyToken: buyToken.address, sellAmount, taker: address, slippageBps });
    if (id !== quoteRequestId.current) return null;
    setOutcome(result);
    setQuoting(false);
    return result;
  }, [chain, sellToken, buyToken, sellAmount, address, slippageBps]);

  // A new request supersedes the last, after a pause in typing.
  useEffect(() => {
    quoteRequestId.current++;
    setOutcome(null);
    if (!quoteKey) {
      setQuoting(false);
      return;
    }
    const timer = setTimeout(() => void loadQuote(), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [quoteKey, loadQuote]);

  // A shown quote stays current while the tab is visible and nothing is being sent.
  useEffect(() => {
    if (outcome?.kind !== "quote" || busy) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadQuote();
    }, QUOTE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [outcome, busy, loadQuote]);

  // The sell token's balance, for the MAX button and the balance check.
  const refreshBalance = useCallback(async () => {
    setSellBalance(null);
    if (!address || !sellToken) return;
    try {
      const balance = isNative(sellToken.address)
        ? await client.getBalance({ address })
        : await client.readContract({ address: sellToken.address, abi: erc20Abi, functionName: "balanceOf", args: [address] });
      setSellBalance(balance);
    } catch {
      setSellBalance(null);
    }
  }, [address, sellToken, client]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  // eUSD and native USDC swap 1:1 in the vault when it holds enough of the token bought.
  const pair = vaultPair(chain);
  const isVaultPair =
    !!sellToken &&
    !!buyToken &&
    [sellToken.address.toLowerCase(), buyToken.address.toLowerCase()].sort().join() === [pair.eusd.toLowerCase(), pair.usdc.toLowerCase()].sort().join();
  useEffect(() => {
    setVaultCovers(false);
    if (!isVaultPair || !sellAmount || !buyToken) return;
    let cancelled = false;
    client
      .readContract({ address: VAULT_DEPLOYMENTS[chainId].vault, abi: vaultAbi, functionName: "getReserves" })
      .then(([stableReserve, gemReserve]) => {
        const reserve = buyToken.address.toLowerCase() === pair.eusd.toLowerCase() ? stableReserve : gemReserve;
        if (!cancelled) setVaultCovers(reserve >= sellAmount);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isVaultPair, sellAmount, buyToken, client, chainId, pair.eusd]);

  const selectChain = (id: number) => {
    const next = SWAP_CHAIN_BY_ID[id];
    if (!next || next === chain) return;
    setChain(next);
    setSellAddress(vaultPair(next).usdc);
    setBuyAddress(SWAP_TOKENS[next][0].address);
    setStep({ kind: "idle" });
  };

  const flip = () => {
    setSellAddress(buyAddress);
    setBuyAddress(sellAddress);
    setAmountText("");
  };

  const addCustomToken = async () => {
    setCustomNote(null);
    const token = await resolveToken(customAddress.trim());
    if (!token) {
      setCustomNote(`That isn't a token on ${CHAIN_NAMES[chain]}.`);
      return;
    }
    setCustomNote(`${token.symbol} added to the lists.`);
    setCustomAddress("");
  };

  const explorerTx = (hash: Hash) => `${VAULT_DEPLOYMENTS[chainId].explorerUrl}/tx/${hash}`;

  const waitFor = async (hash: Hash) => {
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: CONFIRMATIONS[chain], timeout: RECEIPT_TIMEOUT_MS });
    return receipt.status === "success";
  };

  const fail = (error: unknown, hash?: Hash) => {
    const { tone, message } = describeError(error);
    setStep({ kind: "failed", message, tone, hash });
  };

  const switchNetwork = async () => {
    setStep({ kind: "busy", label: `Switch your wallet to ${CHAIN_NAMES[chain]}…` });
    try {
      await switchChainAsync({ chainId });
      setStep({ kind: "idle" });
    } catch (error) {
      fail(error);
    }
  };

  const approve = async (quote: Extract<QuoteOutcome, { kind: "quote" }>["quote"]) => {
    if (!sellToken || !sellAmount || !quote.allowance) return;
    setStep({ kind: "busy", label: `Approve ${sellToken.symbol} in your wallet…` });
    let hash: Hash | undefined;
    try {
      hash = await writeContractAsync({ chainId, address: sellToken.address, abi: erc20Abi, functionName: "approve", args: [quote.allowance.spender, sellAmount] });
      setStep({ kind: "busy", label: `Approving ${sellToken.symbol}…`, hash });
      if (!(await waitFor(hash))) {
        setStep({ kind: "failed", message: "The approval failed on chain. Nothing was swapped.", tone: "error", hash });
        return;
      }
      setStep({ kind: "idle" });
      await loadQuote();
    } catch (error) {
      fail(error, hash);
    }
  };

  const swap = async (shown: Extract<QuoteOutcome, { kind: "quote" }>) => {
    if (!buyToken) return;
    // A quote past its life is replaced, and the visitor confirms the new figures before anything is sent.
    if (!isQuoteFresh(shown.fetchedAt)) {
      setStep({ kind: "busy", label: "Refreshing the quote…" });
      await loadQuote();
      setStep({ kind: "failed", message: "The quote was out of date, so it was refreshed. Check the new amount and swap again.", tone: "info" });
      return;
    }
    const transaction = shown.quote.transaction;
    if (!transaction) return;
    setStep({ kind: "busy", label: "Confirm the swap in your wallet…" });
    let hash: Hash | undefined;
    try {
      hash = await sendTransactionAsync({ chainId, to: transaction.to, data: transaction.data, value: BigInt(transaction.value) });
      setStep({ kind: "busy", label: "Swapping…", hash });
      if (!(await waitFor(hash))) {
        setStep({ kind: "failed", message: "The swap failed on chain, so nothing was swapped. The price may have moved past your slippage.", tone: "error", hash });
        return;
      }
      const received = `${formatTokenAmount(formatUnits(BigInt(shown.quote.buyAmount), buyToken.decimals))}`;
      notifyVaultSwapConfirmed({ amountOutLabel: `about ${received}`, symbolOut: buyToken.symbol, href: explorerTx(hash) });
      setStep({ kind: "done", hash, message: `Swap confirmed: about ${received} ${buyToken.symbol}.` });
      setAmountText("");
      void refreshBalance();
    } catch (error) {
      fail(error, hash);
    }
  };

  const quote = outcome?.kind === "quote" ? outcome : null;
  const wrongNetwork = isConnected && walletChain?.id !== chainId;
  const needsApproval = !!quote?.quote.allowance && !!sellAmount && BigInt(quote.quote.allowance.actual) < sellAmount;
  const short = !!quote?.quote.balanceShort || (sellBalance !== null && sellAmount !== null && sellBalance < sellAmount);

  let action: { label: string; onClick?: () => void; disabled: boolean } | null = null;
  if (isConnected && sellToken && buyToken) {
    if (!sellAmount) action = { label: "Enter an amount", disabled: true };
    else if (wrongNetwork) action = { label: `Switch to ${CHAIN_NAMES[chain]}`, onClick: () => void switchNetwork(), disabled: busy };
    else if (short) action = { label: `Not enough ${sellToken.symbol}`, disabled: true };
    else if (!quote) action = { label: quoting ? "Getting a quote…" : "No quote", disabled: true };
    else if (needsApproval) action = { label: `Approve ${sellToken.symbol}`, onClick: () => void approve(quote.quote), disabled: busy };
    else action = { label: "Swap", onClick: () => void swap(quote), disabled: busy || !quote.quote.transaction };
  }

  const rate =
    quote && sellToken && buyToken
      ? Number(formatUnits(BigInt(quote.quote.buyAmount), buyToken.decimals)) / Number(formatUnits(BigInt(quote.quote.sellAmount), sellToken.decimals))
      : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-20 text-white">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl">Swap</h1>
        <p className="text-sm text-primary">Swap any token on Ethereum, Polygon or Base. Routes come from the 0x Swap API; TELx adds no fee.</p>
      </header>

      <VaultNetworkSelector chainIds={VAULT_CHAIN_IDS} selectedChainId={chainId} onSelect={selectChain} disabled={busy} />

      <VaultCard title="Swap" titleHidden>
        <div className="flex flex-col gap-4">
          <div className={PANEL}>
            <div className="flex items-center justify-between text-xs text-primary">
              <label htmlFor={sellId}>From</label>
              {sellToken && sellBalance !== null && (
                <span>
                  Balance {formatTokenAmount(formatUnits(sellBalance, sellToken.decimals))}{" "}
                  <button type="button" className="underline" onClick={() => setAmountText(formatUnits(sellBalance, sellToken.decimals))} disabled={busy}>
                    MAX
                  </button>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                id={amountId}
                aria-label="Amount to sell"
                inputMode="decimal"
                placeholder="0.0"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value.replace(",", "."))}
                disabled={busy}
                className={`${FIELD} min-w-0 flex-1 text-lg`}
              />
              <select id={sellId} aria-label="Token to sell" value={sellAddress} onChange={(event) => setSellAddress(event.target.value)} disabled={busy} className={FIELD}>
                {options.map((token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button type="button" onClick={flip} disabled={busy} className="mx-auto rounded-full border border-white/20 px-3 py-1 text-sm" aria-label="Swap the From and To tokens">
            ↓↑
          </button>

          <div className={PANEL}>
            <label htmlFor={buyId} className="text-xs text-primary">
              To
            </label>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-lg" aria-live="polite">
                {quote && buyToken ? formatTokenAmount(formatUnits(BigInt(quote.quote.buyAmount), buyToken.decimals)) : quoting ? "…" : "0.0"}
              </p>
              <select id={buyId} aria-label="Token to buy" value={buyAddress} onChange={(event) => setBuyAddress(event.target.value)} disabled={busy} className={FIELD}>
                {options.map((token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-primary">
            <span>Slippage</span>
            {SLIPPAGE_OPTIONS_BPS.map((bps) => (
              <button
                key={bps}
                type="button"
                aria-pressed={slippageBps === bps}
                onClick={() => setSlippageBps(bps)}
                disabled={busy}
                className={`${CHIP} ${slippageBps === bps ? "border-accent bg-accent text-white" : "border-white/10"}`}
              >
                {bps / 100}%
              </button>
            ))}
          </div>

          {quote && sellToken && buyToken && (
            <dl className="grid grid-cols-2 gap-1 text-xs text-primary">
              <dt>Rate</dt>
              <dd className="text-right text-white">
                1 {sellToken.symbol} = {rate !== null ? formatTokenAmount(String(rate)) : "?"} {buyToken.symbol}
              </dd>
              <dt>Minimum received</dt>
              <dd className="text-right text-white">
                {formatTokenAmount(formatUnits(BigInt(quote.quote.minBuyAmount), buyToken.decimals))} {buyToken.symbol}
              </dd>
              {quote.quote.sources.length > 0 && (
                <>
                  <dt>Route</dt>
                  <dd className="text-right">{quote.quote.sources.join(", ").replaceAll("_", " ")}</dd>
                </>
              )}
            </dl>
          )}

          {isVaultPair && vaultCovers && (
            <p className="rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
              eUSD and USDC swap 1:1 with no slippage in the{" "}
              <Link href="/eusd-vault" className="underline">
                eUSD vault
              </Link>
              .
            </p>
          )}
          {outcome?.kind === "no-liquidity" && <p className="text-sm text-amber-400">There&apos;s no route for this swap right now. Try a smaller amount or another token.</p>}
          {outcome?.kind === "error" && <p className="text-sm text-amber-400">{outcome.message}</p>}

          {!isConnected ? (
            <CustomConnectButton />
          ) : action ? (
            <button type="button" className={PRIMARY} onClick={action.onClick} disabled={action.disabled}>
              {action.label}
            </button>
          ) : null}

          <div role="status" aria-live="polite" className="text-sm">
            {step.kind === "busy" && <p>{step.label}</p>}
            {step.kind === "done" && <p className="text-status-complete">{step.message}</p>}
            {step.kind === "failed" && <p className={step.tone === "error" ? "text-red-300" : step.tone === "warning" ? "text-amber-400" : "text-primary"}>{step.message}</p>}
            {"hash" in step && step.hash && (
              <a href={explorerTx(step.hash)} target="_blank" rel="noopener noreferrer" className="text-xs text-tblue-700 underline">
                View transaction
              </a>
            )}
          </div>
        </div>
      </VaultCard>

      <div className="flex flex-col gap-2 text-sm">
        <label htmlFor={customId} className="text-primary">
          Another token on {CHAIN_NAMES[chain]}? Paste its address.
        </label>
        <div className="flex gap-2">
          <input id={customId} value={customAddress} onChange={(event) => setCustomAddress(event.target.value)} placeholder="0x…" className={`${FIELD} min-w-0 flex-1 font-mono text-xs`} />
          <button type="button" onClick={() => void addCustomToken()} className={`${CHIP} border-white/20`}>
            Add
          </button>
        </div>
        {customNote && <p className="text-xs text-primary">{customNote}</p>}
        <p className="text-xs text-primary">Only add tokens you trust: anyone can create a token with any name.</p>
      </div>
    </div>
  );
}
