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
import { formatTokenAmount, formatUsd } from "@/lib/positionView";
import { vaultAbi } from "@/web3/eusdVault/abis";
import { VAULT_CHAIN_IDS, VAULT_DEPLOYMENTS } from "@/web3/eusdVault/deployments";
import { describeError } from "@/web3/eusdVault/errors";
import { fetchQuote, isQuoteFresh, parseSellAmount, QUOTE_REFRESH_MS, type QuoteOutcome } from "@/web3/swap/quote";
import { formatTokenAmountDown } from "@/web3/swap/format";
import {
  DEFAULT_SLIPPAGE_BPS,
  parseSlippagePercent,
  readSlippageChoice,
  slippageLabel,
  SLIPPAGE_OPTIONS_BPS,
  writeSlippageChoice,
} from "@/web3/swap/slippage";
import { isNative, listedToken, uniswapSwapUrl, SWAP_CHAIN_BY_ID, SWAP_CHAIN_IDS, SWAP_TOKENS, vaultPair, type SwapToken } from "@/web3/swap/tokens";
import { fetchSwapPrices, formatValueChange, usdValue, USD_PRICE_REFRESH_MS, valueChangeLevel, valueChangePct } from "@/web3/swap/usd";
import { TokenIcon, TokenPicker } from "./TokenPicker";

const CLIENTS = { ethereum: publicClientEthereum, polygon: publicClientPolygon, base: publicClientBase } as const;
const CHAIN_NAMES: Record<RpcChain, string> = { ethereum: "Ethereum", polygon: "Polygon", base: "Base" };
/** Polygon sees one-block reorgs routinely, so a swap's receipt waits for a few blocks there, as the eUSD vault does. */
const CONFIRMATIONS: Record<RpcChain, number> = { ethereum: 1, polygon: 3, base: 1 };
/**
 * An approval waits for one block on every chain: if it were reorged out, the swap would fail the wallet's
 * simulation and say so, and nothing would be lost.
 */
const APPROVAL_CONFIRMATIONS = 1;
const RECEIPT_TIMEOUT_MS = 5 * 60_000;
const QUOTE_DEBOUNCE_MS = 400;

// The From and To panels are one tinted surface each, with no inner frame: the amount sits directly on the panel,
// and the panel's ring brightens while its input has focus.
const PANEL =
  "flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-transparent transition-colors focus-within:ring-accent-light/40";
const AMOUNT_FIELD =
  "rounded-lg bg-transparent px-1 py-1 text-2xl text-white placeholder:text-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed";
const FIELD = "rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
// Touch layouts (a coarse pointer, or below sm) get controls at least 40px tall.
const TOUCH_TARGET = "pointer-coarse:min-h-10 max-sm:min-h-10";
const PRIMARY = "w-full rounded-xl bg-ocean-gradient px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const CHIP = `inline-flex cursor-pointer items-center rounded-full border px-3 py-1 text-xs transition-colors pointer-coarse:px-4 max-sm:px-4 ${TOUCH_TARGET}`;
const CHIP_IDLE = "border-white/10 text-primary hover:bg-navy/50 hover:text-white";

type Step =
  | { kind: "idle" }
  | { kind: "busy"; label: string; hash?: Hash }
  | { kind: "done"; hash: Hash; message: string }
  | { kind: "failed"; message: string; tone: "info" | "warning" | "error"; hash?: Hash };

/**
 * An approval this page saw confirm, which 0x's quotes may not reflect for a few blocks because 0x reads allowances
 * from its own node. Addresses are lowercase.
 */
type LocalAllowance = { chain: RpcChain; token: string; spender: string; account: string; amount: bigint };

/** A token's symbol with its logo, for running text. */
function TokenLabel({ token }: { token: SwapToken }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <TokenIcon token={token} size={16} />
      {token.symbol}
    </span>
  );
}

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
  const [slippageCustom, setSlippageCustom] = useState(false);
  const [slippageText, setSlippageText] = useState("");
  const [customTokens, setCustomTokens] = useState<Record<string, SwapToken>>({});
  const [customAddress, setCustomAddress] = useState("");
  const [customNote, setCustomNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<QuoteOutcome | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [sellBalance, setSellBalance] = useState<bigint | null>(null);
  const [vaultCovers, setVaultCovers] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [localAllowance, setLocalAllowance] = useState<LocalAllowance | null>(null);
  const [usdPrices, setUsdPrices] = useState<Record<string, number>>({});
  const quoteRequestId = useRef(0);
  const amountId = useId();
  const sellId = useId();
  const buyId = useId();
  const customId = useId();
  const slippageId = useId();

  const client = CLIENTS[chain];
  const chainId = SWAP_CHAIN_IDS[chain];
  const tokenFor = useCallback((tokenAddress: string) => listedToken(chain, tokenAddress) ?? customTokens[`${chain}:${tokenAddress.toLowerCase()}`], [chain, customTokens]);
  const options = useMemo(() => [...SWAP_TOKENS[chain], ...Object.entries(customTokens).filter(([key]) => key.startsWith(`${chain}:`)).map(([, token]) => token)], [chain, customTokens]);
  const sellToken = tokenFor(sellAddress);
  const buyToken = tokenFor(buyAddress);
  const sellAmount = sellToken ? parseSellAmount(amountText, sellToken.decimals) : null;
  const busy = step.kind === "busy";
  const sameToken = !!sellToken && !!buyToken && sellToken.address.toLowerCase() === buyToken.address.toLowerCase();
  const customSlippage = slippageCustom ? parseSlippagePercent(slippageText) : null;

  // The slippage chosen on an earlier visit, read after mount so the server render and the first client render agree.
  useEffect(() => {
    const saved = readSlippageChoice(typeof window === "undefined" ? undefined : window.localStorage);
    if (!saved) return;
    setSlippageBps(saved.bps);
    setSlippageCustom(saved.custom);
    if (saved.custom) setSlippageText(String(saved.bps / 100));
  }, []);

  const choosePreset = (bps: number) => {
    setSlippageCustom(false);
    setSlippageBps(bps);
    writeSlippageChoice(window.localStorage, { bps, custom: false });
  };

  // A valid custom value applies at once; an invalid one leaves the last valid slippage in force and says why.
  const typeCustomSlippage = (text: string) => {
    setSlippageCustom(true);
    setSlippageText(text);
    const parsed = parseSlippagePercent(text);
    if (!parsed.ok) return;
    setSlippageBps(parsed.bps);
    writeSlippageChoice(window.localStorage, { bps: parsed.bps, custom: true });
  };

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

  // Addresses take the token's own spelling, so the pickers match their options whatever the query string's case.
  useEffect(() => {
    const pickers = [
      [sellAddress, setSellAddress],
      [buyAddress, setBuyAddress],
    ] as const;
    for (const [tokenAddress, setAddress] of pickers) {
      const known = tokenFor(tokenAddress);
      if (known) {
        if (known.address !== tokenAddress) setAddress(known.address);
      } else {
        void resolveToken(tokenAddress).then((token) => token && setAddress(token.address));
      }
    }
  }, [sellAddress, buyAddress, tokenFor, resolveToken]);

  const quoteKey = sellToken && buyToken && sellAmount && !sameToken ? `${chain}|${sellToken.address}|${buyToken.address}|${sellAmount}|${slippageBps}|${address ?? ""}` : null;

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

  // The local allowance lasts until the chain, sell token, account or spender changes, or a quote catches up with it.
  useEffect(() => {
    setLocalAllowance((current) => {
      if (!current) return current;
      if (current.chain !== chain || current.token !== sellToken?.address.toLowerCase() || current.account !== address?.toLowerCase()) return null;
      if (outcome?.kind !== "quote") return current;
      const allowance = outcome.quote.allowance;
      if (!allowance || allowance.spender.toLowerCase() !== current.spender || BigInt(allowance.actual) >= current.amount) return null;
      return current;
    });
  }, [chain, sellToken, address, outcome]);

  // USD prices for the two picked tokens, refreshed while the tab is visible. They inform and never block a swap.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void fetchSwapPrices(chain, [sellAddress, buyAddress]).then((prices) => {
        if (!cancelled) setUsdPrices(prices);
      });
    setUsdPrices({});
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, USD_PRICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [chain, sellAddress, buyAddress]);

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

  /** Moves the form to chain `id`, with that chain's default pair. */
  const showChain = useCallback(
    (id: number) => {
      const next = SWAP_CHAIN_BY_ID[id];
      if (!next || next === chain) return;
      setChain(next);
      setSellAddress(vaultPair(next).usdc);
      setBuyAddress(SWAP_TOKENS[next][0].address);
      setStep({ kind: "idle" });
    },
    [chain],
  );

  /**
   * A chain picked on the page also asks the wallet to switch. Declining leaves the page on the picked chain
   * with its Switch button, so nothing is lost.
   */
  const selectChain = (id: number) => {
    const next = SWAP_CHAIN_BY_ID[id];
    if (!next || next === chain) return;
    showChain(id);
    if (isConnected && walletChain?.id !== id) switchChainAsync({ chainId: SWAP_CHAIN_IDS[next] }).catch(() => {});
  };

  // The page follows the wallet: each change of the wallet's chain to a swap chain moves the form there. A
  // chain named in the link wins on arrival, so the wallet's first known chain is only noted then.
  const seenWalletChain = useRef<number | undefined>(undefined);
  const linkNamesChain = useRef(params.has("chain"));
  useEffect(() => {
    const id = walletChain?.id;
    if (id === undefined || id === seenWalletChain.current) return;
    const first = seenWalletChain.current === undefined;
    seenWalletChain.current = id;
    if (first && linkNamesChain.current) return;
    showChain(id);
  }, [walletChain?.id, showChain]);

  const flip = () => {
    setSellAddress(buyAddress);
    setBuyAddress(sellAddress);
    setAmountText("");
  };

  const customOnChain = options.filter((token) => !listedToken(chain, token.address));

  /** The chain's default for a picker, avoiding the token the other picker holds. */
  const fallbackFor = (side: "sell" | "buy", other: string) => {
    const preferred = side === "sell" ? vaultPair(chain).usdc : SWAP_TOKENS[chain][0].address;
    if (preferred.toLowerCase() !== other.toLowerCase()) return preferred;
    return SWAP_TOKENS[chain].find((token) => token.address.toLowerCase() !== other.toLowerCase())!.address;
  };

  // Removing the token a picker holds moves that picker to the chain's default.
  const removeCustomTokens = (addresses: readonly string[]) => {
    const removed = new Set(addresses.map((tokenAddress) => `${chain}:${tokenAddress.toLowerCase()}`));
    setCustomTokens((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !removed.has(key))));
    const sellRemoved = removed.has(`${chain}:${sellAddress.toLowerCase()}`);
    const buyRemoved = removed.has(`${chain}:${buyAddress.toLowerCase()}`);
    const nextBuy = buyRemoved ? fallbackFor("buy", sellRemoved ? "" : sellAddress) : buyAddress;
    if (sellRemoved) setSellAddress(fallbackFor("sell", nextBuy));
    if (buyRemoved) setBuyAddress(nextBuy);
    setCustomNote(addresses.length === 1 ? "Token removed from the lists." : "Custom tokens cleared.");
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

  const waitFor = async (hash: Hash, confirmations: number) => {
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations, timeout: RECEIPT_TIMEOUT_MS });
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
    if (!sellToken || !sellAmount || !quote.allowance || !address) return;
    const spender = quote.allowance.spender;
    setStep({ kind: "busy", label: `Approve ${sellToken.symbol} in your wallet…` });
    let hash: Hash | undefined;
    try {
      hash = await writeContractAsync({ chainId, address: sellToken.address, abi: erc20Abi, functionName: "approve", args: [spender, sellAmount] });
      setStep({ kind: "busy", label: `Approving ${sellToken.symbol}…`, hash });
      if (!(await waitFor(hash, APPROVAL_CONFIRMATIONS))) {
        setStep({ kind: "failed", message: "The approval failed on chain. Nothing was swapped.", tone: "error", hash });
        return;
      }
      // The Swap button shows at once; the quote refreshes behind it, and a stale one is caught when Swap is clicked.
      setLocalAllowance({ chain, token: sellToken.address.toLowerCase(), spender: spender.toLowerCase(), account: address.toLowerCase(), amount: sellAmount });
      setStep({ kind: "idle" });
      void loadQuote();
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
      if (!(await waitFor(hash, CONFIRMATIONS[chain]))) {
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
  const quotedAllowance = quote?.quote.allowance ?? null;
  const localApproved =
    localAllowance && quotedAllowance && localAllowance.spender === quotedAllowance.spender.toLowerCase() ? localAllowance.amount : 0n;
  const needsApproval = !!quotedAllowance && !!sellAmount && BigInt(quotedAllowance.actual) < sellAmount && localApproved < sellAmount;
  const short = !!quote?.quote.balanceShort || (sellBalance !== null && sellAmount !== null && sellBalance < sellAmount);

  let action: { label: string; onClick?: () => void; disabled: boolean } | null = null;
  if (isConnected && sellToken && buyToken) {
    if (!sellAmount) action = { label: "Enter an amount", disabled: true };
    else if (sameToken) action = { label: "Pick two different assets", disabled: true };
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

  const sellPrice = sellToken ? usdPrices[sellToken.address.toLowerCase()] : undefined;
  const buyPrice = buyToken ? usdPrices[buyToken.address.toLowerCase()] : undefined;
  const soldUsd = sellToken && sellAmount ? usdValue(sellAmount, sellToken.decimals, sellPrice) : null;
  const receivedUsd = quote && buyToken ? usdValue(BigInt(quote.quote.buyAmount), buyToken.decimals, buyPrice) : null;
  const minimumUsd = quote && buyToken ? usdValue(BigInt(quote.quote.minBuyAmount), buyToken.decimals, buyPrice) : null;
  const valueChange = valueChangePct(soldUsd, receivedUsd);
  const valueLevel = valueChangeLevel(valueChange);
  const usdLabel = (value: number | null) => (value === null ? "No USD price" : `≈ ${formatUsd(value)}`);

  const feeToken = quote?.quote.zeroExFee ? [sellToken, buyToken].find(token => token && token.address.toLowerCase() === quote.quote.zeroExFee!.token.toLowerCase()) : undefined;
  const zeroExFeeLabel = !quote?.quote.zeroExFee ? (
    "None on this pair"
  ) : feeToken ? (
    <>
      {formatTokenAmount(formatUnits(BigInt(quote.quote.zeroExFee.amount), feeToken.decimals))} <TokenLabel token={feeToken} />
    </>
  ) : (
    "Included in the rate"
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-20 text-white">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl">Swap</h1>
        <p className="text-sm text-primary">
          Swap any token on Ethereum, Polygon or Base. Routes come from the 0x Swap API, which charges a 0.15% fee on some pairs. TELx adds no
          fee of its own.
        </p>
        <p className="text-sm text-primary">
          Prefer Uniswap?{" "}
          <a
            href={uniswapSwapUrl(chain, sellToken?.address, buyToken?.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white underline transition-colors hover:text-link-hover"
          >
            Make this swap on Uniswap
          </a>
          .
        </p>
      </header>

      <VaultNetworkSelector chainIds={VAULT_CHAIN_IDS} selectedChainId={chainId} onSelect={selectChain} disabled={busy} />

      <VaultCard title="Swap" titleHidden>
        <div className="flex flex-col gap-4">
          <div className={PANEL}>
            <div className="flex items-center justify-between text-xs text-primary">
              <label htmlFor={sellId}>From</label>
              {sellToken && sellBalance !== null && (
                <span>
                  Balance {formatTokenAmountDown(formatUnits(sellBalance, sellToken.decimals))}{" "}
                  <button type="button" className="underline" onClick={() => setAmountText(formatUnits(sellBalance, sellToken.decimals))} disabled={busy}>
                    MAX
                  </button>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id={amountId}
                aria-label="Amount to sell"
                inputMode="decimal"
                placeholder="0.0"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value.replace(",", "."))}
                disabled={busy}
                className={`${AMOUNT_FIELD} min-w-0 flex-1`}
              />
              <TokenPicker id={sellId} label="Token to sell" value={sellAddress} options={options} token={sellToken} onChange={setSellAddress} disabled={busy} />
            </div>
            {sellAmount && (
              <p data-testid="sell-usd" className="px-1 text-xs text-primary">
                {usdLabel(soldUsd)}
              </p>
            )}
          </div>

          <button type="button" onClick={flip} disabled={busy} className={`mx-auto inline-flex min-w-10 items-center justify-center rounded-full border border-white/20 px-3 py-1 text-sm transition-colors hover:bg-navy/50 ${TOUCH_TARGET}`}
            aria-label="Swap the From and To tokens">
            ↓↑
          </button>

          <div className={PANEL}>
            <label htmlFor={buyId} className="text-xs text-primary">
              To
            </label>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 px-1 py-1 text-2xl" aria-live="polite">
                {quote && buyToken ? formatTokenAmount(formatUnits(BigInt(quote.quote.buyAmount), buyToken.decimals)) : quoting ? "…" : "0.0"}
              </p>
              <TokenPicker id={buyId} label="Token to buy" value={buyAddress} options={options} token={buyToken} onChange={setBuyAddress} disabled={busy} />
            </div>
            {quote && (
              <p data-testid="buy-usd" className="px-1 text-xs text-primary">
                {usdLabel(receivedUsd)}
                {valueChange !== null && (
                  <span
                    data-testid="value-change"
                    title="The value received against the value sold, at current USD prices"
                    className={`ml-1 ${valueLevel === "high" ? "font-bold text-red-300" : valueLevel === "warn" ? "text-amber-400" : "text-primary"}`}
                  >
                    ({formatValueChange(valueChange)})
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 text-xs text-primary">
            <div role="group" aria-label="Slippage" className="flex flex-wrap items-center gap-2">
              <span>Slippage</span>
              {SLIPPAGE_OPTIONS_BPS.map((bps) => {
                const active = !slippageCustom && slippageBps === bps;
                return (
                  <button
                    key={bps}
                    type="button"
                    aria-pressed={active}
                    onClick={() => choosePreset(bps)}
                    disabled={busy}
                    className={`${CHIP} ${active ? "border-accent bg-accent text-white" : CHIP_IDLE}`}
                  >
                    {slippageLabel(bps)}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={slippageCustom}
                onClick={() => typeCustomSlippage(slippageCustom ? slippageText : String(slippageBps / 100))}
                disabled={busy}
                className={`${CHIP} ${slippageCustom ? "border-accent bg-accent text-white" : CHIP_IDLE}`}
              >
                Custom
              </button>
              {slippageCustom && (
                <span className="inline-flex items-center gap-1">
                  <input
                    id={slippageId}
                    aria-label="Custom slippage percentage"
                    inputMode="decimal"
                    value={slippageText}
                    onChange={(event) => typeCustomSlippage(event.target.value)}
                    disabled={busy}
                    aria-invalid={customSlippage?.ok === false}
                    className={`${FIELD} w-20 py-1 text-right text-xs ${TOUCH_TARGET}`}
                  />
                  %
                </span>
              )}
            </div>
            {customSlippage && !customSlippage.ok && (
              <p className="text-amber-400">
                {customSlippage.message} The swap uses {slippageLabel(slippageBps)} until then.
              </p>
            )}
            {customSlippage?.ok && customSlippage.high && (
              <p className="text-amber-400">High slippage: this swap can fill at up to {slippageLabel(customSlippage.bps)} less than quoted.</p>
            )}
          </div>

          {quote && sellToken && buyToken && (
            <dl className="grid grid-cols-2 gap-1 text-xs text-primary">
              <dt>Rate</dt>
              <dd className="text-right text-white">
                1 <TokenLabel token={sellToken} /> = {rate !== null ? formatTokenAmount(String(rate)) : "?"} <TokenLabel token={buyToken} />
              </dd>
              <dt>Minimum received</dt>
              <dd className="text-right text-white">
                {formatTokenAmountDown(formatUnits(BigInt(quote.quote.minBuyAmount), buyToken.decimals))} <TokenLabel token={buyToken} />
                {minimumUsd !== null && <span className="ml-1 text-primary">({usdLabel(minimumUsd)})</span>}
              </dd>
              <dt>0x fee</dt>
              <dd className="text-right text-white">{zeroExFeeLabel}</dd>
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
          {sameToken && <p className="text-sm text-amber-400">The sell asset and buy asset must be different.</p>}
          {quote && valueLevel !== "ok" && valueChange !== null && (
            <p role="alert" className={`rounded-xl border p-3 text-sm ${valueLevel === "high" ? "border-red-300/50 bg-red-500/10 text-red-200" : "border-amber-400/40 bg-amber-400/10 text-amber-200"}`}>
              {valueLevel === "high"
                ? `This swap returns about ${Math.abs(valueChange).toFixed(1)}% less in value than it sells. Check the amount, try a smaller swap, or compare on Uniswap before going ahead.`
                : `This swap returns about ${Math.abs(valueChange).toFixed(1)}% less in value than it sells, at current USD prices.`}
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
          <button type="button" onClick={() => void addCustomToken()} className={`${CHIP} border-white/20 text-primary hover:bg-navy/50 hover:text-white`}>
            Add
          </button>
        </div>
        {customNote && <p className="text-xs text-primary">{customNote}</p>}
        {customOnChain.length > 0 && (
          <div role="group" aria-label={`Custom tokens on ${CHAIN_NAMES[chain]}`} className="flex flex-wrap items-center gap-2">
            {customOnChain.map((token) => (
              <span key={token.address} className="inline-flex items-center gap-1 rounded-full border border-white/10 py-0.5 pl-3 pr-1 text-xs text-white">
                <span title={token.address}>{token.symbol}</span>
                <button
                  type="button"
                  aria-label={`Remove ${token.symbol}`}
                  onClick={() => removeCustomTokens([token.address])}
                  disabled={busy}
                  className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-primary transition-colors hover:bg-navy/50 hover:text-white"
                >
                  ×
                </button>
              </span>
            ))}
            <button type="button" onClick={() => removeCustomTokens(customOnChain.map((token) => token.address))} disabled={busy} className={`${CHIP} ${CHIP_IDLE}`}>
              Clear custom assets
            </button>
          </div>
        )}
        <p className="text-xs text-primary">Only add tokens you trust: anyone can create a token with any name.</p>
      </div>
    </div>
  );
}
