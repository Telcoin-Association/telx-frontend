import React from "react";
import HoverTooltip from "../common/HoverTooltip";
import AddTokenToWallet from "../common/AddTokenToWallet";
import { WATCHABLE_TOKENS } from "@/lib/walletTokens";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import { formatUsd } from "@/lib/positionView";
import { formatTel } from "@/lib/portfolioSummary";

export type PortfolioSummaryProps = {
  /** Summed USD value of the wallet's open positions, or null when none could be priced or loaded. */
  positionsValueUsd: number | null;
  /** Why the position value leaves something out, or null when it covers every position. */
  positionsPartialNote: string | null;
  positionsLoading: boolean;
  /** Claimable TEL from Merkl campaigns, or null when no chain could be read. */
  claimableTel: number | null;
  /** Claimable legacy TEL from the old Uniswap and deprecated staking pools; not priced, since legacy TEL has no rate. */
  legacyClaimableTel: number | null;
  /** Why the claimable total leaves something out, or null when every source was read. */
  claimablePartialNote: string | null;
  claimableLoading: boolean;
  /** Merkl rewards earned but not yet in a claimable root, or null when no chain could be read. */
  pendingTel: number | null;
  telUsd: number | null;
  openPositions: number;
  subscribedPositions: number;
  /** The tile's claim button: its label, why it is off (null when it is on), and what it does. */
  claimAction?: { label: string; disabledReason: string | null; onClick: () => void };
};

function PartialMarker({ note, title }: { note: string; title: string }) {
  return (
    <HoverTooltip content={note} label={`${title}: partial total`}>
      <span className="text-xs text-amber-400 underline decoration-amber-400/40 decoration-dotted underline-offset-4">partial</span>
    </HoverTooltip>
  );
}

function Tile({ title, children, footnote }: { title: string; children: React.ReactNode; footnote?: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1 rounded-2xl bg-black/20 px-4 py-3">
      <h4 className="text-sm font-medium text-primary">{title}</h4>
      <div className="flex flex-wrap items-baseline gap-2 text-base text-white">{children}</div>
      {footnote ? <div className="text-xs text-primary">{footnote}</div> : null}
    </div>
  );
}

/**
 * The top of the Portfolio page: what the wallet's positions are worth, the TEL it can claim now and the TEL
 * still pending, and how many of its open positions are subscribed. A total that leaves out a source it could
 * not read carries a "partial" marker naming what is missing.
 */
export default function PortfolioSummary(props: PortfolioSummaryProps) {
  const {
    positionsValueUsd,
    positionsPartialNote,
    positionsLoading,
    claimableTel,
    legacyClaimableTel,
    claimablePartialNote,
    claimableLoading,
    pendingTel,
    telUsd,
    openPositions,
    subscribedPositions,
    claimAction,
  } = props;

  const usdOfTel = (amount: number | null) => (amount !== null && telUsd ? formatUsd(amount * telUsd) : null);
  const claimableNotes = claimableLoading
    ? []
    : [
        legacyClaimableTel ? `Plus ${formatTel(legacyClaimableTel).replace(" TEL", " legacy TEL")} from old pools.` : null,
        claimableTel || legacyClaimableTel ? (claimAction ? "Or claim each amount in its own card below." : "Claim each amount below.") : null,
      ].filter((note): note is string => note !== null);

  return (
    <section aria-label="Portfolio summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile title="Position value">
        {positionsLoading ? (
          <LoadingAnimation size={20} />
        ) : (
          <>
            <span>{positionsValueUsd !== null ? formatUsd(positionsValueUsd) : "Unavailable"}</span>
            {positionsValueUsd !== null && positionsPartialNote && <PartialMarker note={positionsPartialNote} title="Position value" />}
          </>
        )}
      </Tile>

      <Tile
        title="Claimable TEL"
        footnote={
          <>
            {claimAction && !claimableLoading && (
              <span className="mb-1 flex flex-col items-start gap-1">
                <button
                  type="button"
                  onClick={claimAction.onClick}
                  disabled={claimAction.disabledReason !== null}
                  aria-describedby={claimAction.disabledReason ? "claim-all-reason" : undefined}
                  className="rounded-lg bg-ocean-gradient px-3 py-1.5 text-sm font-bold text-white hover-lift disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {claimAction.label}
                </button>
                {claimAction.disabledReason && (
                  <span id="claim-all-reason" className="block">
                    {claimAction.disabledReason}
                  </span>
                )}
              </span>
            )}
            {claimableNotes.map(note => (
              <span key={note} className="block">
                {note}
              </span>
            ))}
            <AddTokenToWallet token={WATCHABLE_TOKENS.TEL} className="mt-1 !items-start" />
          </>
        }
      >
        {claimableLoading ? (
          <LoadingAnimation size={20} />
        ) : (
          <>
            <span>{claimableTel !== null ? formatTel(claimableTel) : "Unavailable"}</span>
            {usdOfTel(claimableTel) && <span className="text-xs text-primary">{usdOfTel(claimableTel)}</span>}
            {claimableTel !== null && claimablePartialNote && <PartialMarker note={claimablePartialNote} title="Claimable TEL" />}
          </>
        )}
      </Tile>

      <Tile title="Pending TEL" footnote={!claimableLoading && pendingTel ? "Claimable once Merkl publishes its next rewards update." : undefined}>
        {claimableLoading ? (
          <LoadingAnimation size={20} />
        ) : (
          <>
            <span>{pendingTel !== null ? formatTel(pendingTel) : "Unavailable"}</span>
            {usdOfTel(pendingTel) && <span className="text-xs text-primary">{usdOfTel(pendingTel)}</span>}
          </>
        )}
      </Tile>

      <Tile title="Subscribed positions" footnote={!positionsLoading && openPositions > subscribedPositions ? "Subscribe a position to earn TELx rewards on it." : undefined}>
        {positionsLoading ? (
          <LoadingAnimation size={20} />
        ) : (
          <span>
            {subscribedPositions} of {openPositions}
          </span>
        )}
      </Tile>
    </section>
  );
}
