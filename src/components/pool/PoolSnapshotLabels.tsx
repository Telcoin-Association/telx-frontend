import React from "react";
import Image from "next/image";
import globeIcon from "../../../public/icons/globe.png";
import HoverTooltip from "@/components/common/HoverTooltip";
import HelpTip from "@/components/common/HelpTip";
import { SUBSCRIBED_VALUE_HELP } from "@/components/common/LabelSubscribedLiquidityRow";
import { SUBSCRIBED_APR_HELP } from "@/helpers/poolRewardsDisplay";
import type { PoolSort, PoolSortKey } from "@/lib/poolOrder";

const SVL_HELP = `Subscribed Value Locked: ${SUBSCRIBED_VALUE_HELP}`;

/** What each sortable column sorts by, as the header and its button name it. */
const SORT_NAMES: Record<PoolSortKey, string> = {
  tvl: "TVL",
  svl: "SVL",
  volume: "Volume (24hr)",
  fees: "Fees (24hr)",
  apr: "Rewards APR",
};

function SortButton({ sortKey, label, sort, onSort }: { sortKey: PoolSortKey; label: string; sort: PoolSort | null; onSort: (key: PoolSortKey) => void }) {
  const active = sort?.key === sortKey ? sort.direction : null;
  const name = SORT_NAMES[sortKey];
  const ariaLabel =
    active === null
      ? `Sort by ${name}, highest first`
      : active === "desc"
        ? `${name}, sorted highest first. Sort lowest first`
        : `${name}, sorted lowest first. Return to the default order`;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 rounded text-xs leading-5 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${active ? "font-bold text-white" : "text-primary"}`}
    >
      {label}
      <span aria-hidden="true" className={active ? "" : "opacity-40"}>
        {active === "asc" ? "↑" : "↓"}
      </span>
    </button>
  );
}

/**
 * The pool list's column headers. With `onSort`, the figure columns are buttons that sort the list: highest first,
 * then lowest first, then back to the default order. Without it (the home page) they are plain labels.
 */
export default function PoolSnapshotLabels({ sort = null, onSort }: { sort?: PoolSort | null; onSort?: (key: PoolSortKey) => void } = {}) {
  const sortable = (key: PoolSortKey, label: string) => (onSort ? <SortButton sortKey={key} label={label} sort={sort} onSort={onSort} /> : null);

  return (
    <div className={["bg-oce an-gradient sticky top-[64px] z-10 rounded-t-2xl bg-gradient-to-r from-[#19245d] to-[#3057A6]"].join(" ")}>
      <div className="text-white-100 mx-auto grid w-full grid-cols-[0.3fr_1fr_0.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr] items-center px-4 py-3 lg:grid-cols-[0.4fr_2.5fr_0.5fr_0.5fr_1fr_1fr_1fr_1fr_1fr]">
        <div>
          <Image src={globeIcon} alt="chain" width={22} height={22} />
        </div>
        <p className="text-xs text-primary">Pool</p>
        <p className="text-left text-xs text-primary">Status</p>
        <p className="text-xs text-primary text-center">Protocol</p>
        <div className="text-right">{sortable("tvl", "TVL") ?? <p className="text-xs leading-5 text-primary">TVL</p>}</div>
        <div className="flex items-center justify-end gap-1 text-right">
          {onSort ? (
            <>
              {sortable("svl", "SVL")}
              <HelpTip text={SVL_HELP} label="About SVL" placement="below" />
            </>
          ) : (
            <HoverTooltip content={SVL_HELP} label="SVL, Subscribed Value Locked" className="text-xs leading-5 text-primary underline decoration-dotted underline-offset-4">
              SVL
            </HoverTooltip>
          )}
        </div>
        <div className="text-right">{sortable("volume", "Volume (24hr)") ?? <p className="text-xs leading-5 text-primary">Volume (24hr)</p>}</div>
        <div className="text-right">{sortable("fees", "Fees (24hr)") ?? <small className="text-xs leading-4 text-primary">Fees (24hr)</small>}</div>
        <div className="mr-8 flex items-center justify-end gap-1 text-right">
          {onSort ? (
            <>
              {sortable("apr", "Rewards")}
              <HelpTip text={SUBSCRIBED_APR_HELP} label="About the Rewards APR" placement="below" />
            </>
          ) : (
            <HoverTooltip content={SUBSCRIBED_APR_HELP} label="Rewards, with the subscribed APR" className="text-xs text-primary underline decoration-dotted underline-offset-4">
              Rewards
            </HoverTooltip>
          )}
        </div>
      </div>
    </div>
  );
}
