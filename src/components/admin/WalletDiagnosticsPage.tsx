"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  explorerTxUrl,
  type AdminChainReport,
  type AdminFlag,
  type AdminPosition,
  type AdminRangeTimeline,
  type AdminWalletReport,
  type UnsubscribeHow,
} from "@/lib/adminWallet";
import { chainDisplayName } from "@/lib/poolTitle";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CARD = "rounded-2xl border border-white/10 bg-black/20 p-4";
const LINK = "underline decoration-white/30 underline-offset-2 hover:text-link-hover";

const STATUS_LABEL: Record<AdminPosition["status"], string> = {
  open: "Open",
  empty: "Empty (no liquidity)",
  burned: "Burned",
  transferred: "Sent to another wallet",
  unknown: "Not held",
};

const HOW_LABEL: Record<UnsubscribeHow, string> = {
  owner: "by the holder",
  burned: "position burned",
  transferred: "position transferred",
  registry: "removed by the registry (pruned or forced)",
  unknown: "how unknown",
};

const FLAG_TONE: Record<AdminFlag["kind"], string> = {
  "subscribed-out-of-range": "border-red-400/40 bg-red-500/10",
  "not-subscribed": "border-red-400/40 bg-red-500/10",
  "not-eligible": "border-red-400/40 bg-red-500/10",
  "below-threshold": "border-amber-300/40 bg-amber-400/10",
  "removed-by-registry": "border-amber-300/40 bg-amber-400/10",
  "mostly-out-of-range": "border-amber-300/40 bg-amber-400/10",
  "out-of-range": "border-amber-300/40 bg-amber-400/10",
  "empty-still-subscribed": "border-white/15 bg-white/5",
  "old-program-pool": "border-white/15 bg-white/5",
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const formatTime = (t: number) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a");
const yesNo = (value: boolean | null) => (value === null ? "unknown" : value ? "yes" : "no");

function RangeBar({ range }: { range: AdminRangeTimeline }) {
  const total = range.to - range.from;
  if (total <= 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={`In range ${share(range.inRangeSeconds, range.activeSeconds)} of the time with liquidity`}>
        {range.spans.map(span => (
          <span
            key={span.from}
            title={`${formatTime(span.from)} to ${formatTime(span.to)}: ${span.inRange === null ? "unknown" : span.inRange ? "in range" : "out of range"}${span.subscribed ? ", subscribed" : ""}`}
            className={`absolute top-0 h-full ${span.inRange === null ? "bg-white/30" : span.inRange ? "bg-green-600" : "bg-red-400"} ${span.subscribed ? "" : "opacity-50"}`}
            style={{ left: `${((span.from - range.from) / total) * 100}%`, width: `${Math.max(((span.to - span.from) / total) * 100, 0.3)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-primary">
        <span>{formatTime(range.from)}</span>
        <span>now</span>
      </div>
    </div>
  );
}

function PositionCard({ position }: { position: AdminPosition }) {
  const range = position.range;
  return (
    <li className={`${CARD} flex flex-col gap-3`} data-testid="diagnostics-position">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a href={position.positionUrl} target="_blank" rel="noreferrer" className={`text-lg ${LINK}`}>
          #{position.tokenId}
        </a>
        <span className="text-sm text-primary">
          {position.poolName ?? "Unknown pool"} · {STATUS_LABEL[position.status]}
          {position.merklPool ? "" : " · outside the TELx program"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
        <dt className="text-primary">Subscribed</dt>
        <dd>{yesNo(position.subscribed)}</dd>
        <dt className="text-primary">In range now</dt>
        <dd>{position.status === "open" ? yesNo(position.inRangeNow) : "n/a"}</dd>
        <dt className="text-primary">Range (ticks)</dt>
        <dd>{position.tickLower !== null && position.tickUpper !== null ? `${position.tickLower} to ${position.tickUpper}` : "unknown"}</dd>
        <dt className="text-primary">Current tick</dt>
        <dd>{position.currentTick ?? "unknown"}</dd>
        {position.amounts && (
          <>
            <dt className="text-primary">Holds</dt>
            <dd className="md:col-span-3">
              {Number(position.amounts.amount0).toLocaleString(undefined, { maximumFractionDigits: 6 })} {position.amounts.symbol0} and{" "}
              {Number(position.amounts.amount1).toLocaleString(undefined, { maximumFractionDigits: 6 })} {position.amounts.symbol1}
            </dd>
          </>
        )}
        {position.registry && (
          <>
            <dt className="text-primary">Registry</dt>
            <dd className="md:col-span-3">
              in range {yesNo(position.registry.isInRange)}, below minimum {yesNo(position.registry.belowThreshold)}, eligible {yesNo(position.registry.eligible)}
            </dd>
          </>
        )}
      </dl>

      {range ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            With liquidity for {formatDuration(range.activeSeconds)}: in range {formatDuration(range.inRangeSeconds)} ({share(range.inRangeSeconds, range.activeSeconds)}), out of
            range {formatDuration(range.outOfRangeSeconds)} ({share(range.outOfRangeSeconds, range.activeSeconds)})
            {range.unknownSeconds > 0 ? `, unknown ${formatDuration(range.unknownSeconds)}` : ""}.
            {range.subscribedSeconds > 0 &&
              ` Subscribed ${formatDuration(range.subscribedSeconds)}, of which out of range ${formatDuration(range.subscribedOutOfRangeSeconds)} (${share(range.subscribedOutOfRangeSeconds, range.subscribedSeconds)}).`}
          </p>
          <RangeBar range={range} />
          {range.spansTruncated && <p className="text-xs text-primary">The bar shows the first runs only; the totals cover the whole time.</p>}
        </div>
      ) : (
        <p className="text-sm text-primary">No range history for this position.</p>
      )}

      {position.subscriptions.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {position.subscriptions.map(event => (
            <li key={`${event.txHash}:${event.kind}`}>
              {formatTime(event.t)}: {event.kind === "subscribed" ? "subscribed" : `unsubscribed, ${HOW_LABEL[event.how ?? "unknown"]}`} (
              <a href={explorerTxUrl(position.chain, event.txHash)} target="_blank" rel="noreferrer" className={LINK}>
                transaction
              </a>
              )
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ChainSection({ report }: { report: AdminChainReport }) {
  const name = chainDisplayName(report.chain);
  return (
    <section className="flex flex-col gap-3" aria-label={name}>
      <h2 className="text-2xl">{name}</h2>
      <div className={`${CARD} flex flex-col gap-2 text-sm`}>
        <p>
          Merkl rewards:{" "}
          {report.merkl === null
            ? "couldn't be read"
            : report.merkl.length === 0
              ? "none"
              : report.merkl
                  .map(reward => `${Number(reward.claimable).toLocaleString()} ${reward.symbol} claimable, ${Number(reward.pending).toLocaleString()} pending, ${Number(reward.claimed).toLocaleString()} claimed`)
                  .join("; ")}
        </p>
        {report.oldPoolsClaimable !== undefined && (
          <p>Old pools claimable: {report.oldPoolsClaimable === null ? "couldn't be read" : `${Number(report.oldPoolsClaimable).toLocaleString()} legacy TEL`}</p>
        )}
        <p className="text-primary">
          Registry requires in-range positions: {yesNo(report.inRangeRequired)}
          {report.head ? ` · read at block ${report.head.block.toLocaleString()}` : ""}
        </p>
        {report.notes.map(note => (
          <p key={note} className="text-primary">
            {note}
          </p>
        ))}
        {report.errors.map(error => (
          <p key={error} className="text-red-300">
            {error}
          </p>
        ))}
      </div>
      {report.positions.length === 0 ? (
        <p className="text-sm text-primary">No TELx positions found on {name}.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {report.positions.map(position => (
            <PositionCard key={position.tokenId} position={position} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Wallet troubleshooting: paste a wallet and see its TELx positions, subscriptions, range history and rewards. */
export default function WalletDiagnosticsPage() {
  const [input, setInput] = useState("");
  const [report, setReport] = useState<AdminWalletReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (address: string) => {
    if (!ADDRESS.test(address)) {
      setError("Enter a valid wallet address (0x followed by 40 hex characters).");
      return;
    }
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const response = await fetch(`/api/wallet-diagnostics?address=${address}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "The report couldn't be loaded.");
      setReport(body as AdminWalletReport);
      const url = new URL(window.location.href);
      url.searchParams.set("address", address);
      window.history.replaceState(null, "", url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report couldn't be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const address = new URLSearchParams(window.location.search).get("address");
    if (address) {
      setInput(address);
      void load(address.trim());
    }
  }, [load]);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-20 text-white">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl">Wallet troubleshooting</h1>
        <p className="text-sm text-primary">
          Paste a wallet to see its TELx positions on every chain: subscriptions, time out of range, the registry&apos;s view and rewards. Reads public onchain data
          and Merkl&apos;s public rewards.
        </p>
      </header>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={event => {
          event.preventDefault();
          void load(input.trim());
        }}
      >
        <label htmlFor="wallet" className="sr-only">
          Wallet address
        </label>
        <input
          id="wallet"
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-ocean-gradient px-4 py-2 text-sm font-bold text-white hover-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
        >
          {loading ? "Reading the chains…" : "Look up"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      {report && (
        <>
          <section className="flex flex-col gap-2" aria-label="Flags">
            <h2 className="text-2xl">Flags</h2>
            {report.flags.length === 0 ? (
              <p className="text-sm text-primary">Nothing stands out.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {report.flags.map(flag => (
                  <li key={`${flag.kind}:${flag.chain}:${flag.tokenId}`} className={`rounded-lg border px-3 py-2 text-sm ${FLAG_TONE[flag.kind]}`} data-testid="diagnostics-flag">
                    <span className="text-primary">{chainDisplayName(flag.chain)}:</span> {flag.message}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {report.chains.map(chain => (
            <ChainSection key={chain.chain} report={chain} />
          ))}
          <p className="text-xs text-primary">Report built {formatTime(report.generatedAt)}. Reports are reused for a minute.</p>
        </>
      )}
    </div>
  );
}
