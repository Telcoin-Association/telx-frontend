import "server-only";

import { z } from "zod";

import type { PoolRewardsIndex, PositionTel } from "@/lib/positions";
import type { RpcChain } from "@/lib/rpc";
import { CHAIN_IDS, MERKL_API } from "@/server/pools/merkl/fetch";

/**
 * TELx rewards per Uniswap v4 position, for every position in one pool, built from Merkl's per-campaign reward rows.
 *
 * - Campaigns: every Uniswap v4 subscription campaign Merkl lists on the pool's chain whose pool is this pool and
 *   whose reward token is TEL (matched by address, never by symbol). Campaigns don't follow a fixed schedule, so they
 *   are listed live rather than assumed.
 * - Rows: every reward row of each campaign. A row is one (recipient, reason), and the reason names the position:
 *   `…_tokenId_<id>_…`. Rows for rounding and unassigned rewards belong to no position; any other reason that names
 *   no position is counted as unresolved and reported, never treated as zero.
 * - Sums per token id, in wei: `amount` is what Merkl has credited so far and `pending` has accrued since its last
 *   update, so their sum is the position's reward. `claimed` is the part of `amount` the recipient has already
 *   claimed: claimable now is `amount` less `claimed`. Claiming doesn't change what was earned.
 *
 * Rows are keyed by position, not by wallet: Merkl can forward rewards to a recipient other than the position's
 * owner, so a wallet's own rewards list can miss a position's rows. A campaign's total is never spread over time
 * per position; only the rows say who earned what.
 *
 * A reward is final once every campaign it comes from is final: the campaign has ended, Merkl has computed it to its
 * end, nothing in it is pending, the Distributor's last root is past its dispute window, and no dispute is open.
 * Until then it is provisional.
 */

/** TEL v3: the same address, with 18 decimals, on every chain. */
export const TEL_V3 = "0x7e13b43065380acdec1c2d138c579cbbbafa0731";
const TEL_DECIMALS = 18;

/** Reasons for reward rows that belong to no position. */
export const NON_POSITION_REASONS = new Set(["roundingError", "no_recipient"]);

const CAMPAIGN_PAGE = 100;
const ROW_PAGE = 1000;
/** Pages read per listing before giving up, far above any real campaign. */
const MAX_PAGES = 50;
const FETCH_TIMEOUT_MS = 20_000;

const Seconds = z.union([z.string(), z.number()]).transform(value => Number(value));

const CampaignSchema = z.object({
  campaignId: z.string(),
  distributionChainId: z.number(),
  startTimestamp: Seconds,
  endTimestamp: Seconds,
  amount: z.string(),
  params: z.object({ poolId: z.string().nullish() }).passthrough().nullish(),
  rewardToken: z.object({ address: z.string() }),
  campaignStatus: z.object({ computedUntil: Seconds.nullish() }).passthrough().nullish(),
});

const RowSchema = z.object({ reason: z.string(), amount: z.string(), pending: z.string().nullish(), claimed: z.string().nullish() });

/** One TEL campaign on the pool, as the index needs it. */
export type PoolCampaign = {
  id: string;
  distributionChainId: number;
  start: number;
  end: number;
  /** The campaign's net amount in wei, after Merkl's fee. */
  amount: bigint;
  /** Merkl has computed the campaign up to this time (unix seconds), or null when it reports none. */
  computedUntil: number | null;
};

export type RewardRow = z.infer<typeof RowSchema>;

/** The Distributor's dispute state on a chain: when the current root's dispute window ends, and the disputer. */
export type DisputeState = { endOfDisputePeriod: number; disputer: string };

export type PoolRewardsDeps = {
  fetchImpl?: typeof fetch;
  /** Reads the Distributor's dispute state on a chain id. */
  readDispute: (chainId: number) => Promise<DisputeState>;
  now?: () => number;
};

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Merkl ${new URL(url).pathname}: HTTP ${res.status}`);
  return res.json();
}

/** Every TEL campaign on `poolId` that Merkl lists on the pool's chain, past, live or upcoming. */
export async function fetchPoolTelCampaigns(chainId: number, poolId: string, fetchImpl: typeof fetch = fetch): Promise<PoolCampaign[]> {
  const wanted = poolId.toLowerCase();
  const campaigns: PoolCampaign[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ chainId: String(chainId), type: "UNISWAP_V4_SUBSCRIPTION", status: "LIVE,SOON,PAST", items: String(CAMPAIGN_PAGE), page: String(page) });
    const parsed = z.array(CampaignSchema).safeParse(await getJson(`${MERKL_API}/campaigns?${params}`, fetchImpl));
    if (!parsed.success) throw new Error(`Merkl campaigns on chain ${chainId}: invalid response. ${z.prettifyError(parsed.error)}`);
    for (const campaign of parsed.data) {
      if (campaign.params?.poolId?.toLowerCase() !== wanted || campaign.rewardToken.address.toLowerCase() !== TEL_V3) continue;
      campaigns.push({
        id: campaign.campaignId.toLowerCase(),
        distributionChainId: campaign.distributionChainId,
        start: campaign.startTimestamp,
        end: campaign.endTimestamp,
        amount: BigInt(campaign.amount),
        computedUntil: campaign.campaignStatus?.computedUntil ?? null,
      });
    }
    if (parsed.data.length < CAMPAIGN_PAGE) return campaigns;
  }
  throw new Error(`Merkl campaigns on chain ${chainId}: more than ${MAX_PAGES} pages`);
}

/** Every reward row of a campaign, paging until a page comes back short. */
export async function fetchCampaignRows(distributionChainId: number, campaignId: string, fetchImpl: typeof fetch = fetch): Promise<RewardRow[]> {
  const rows: RewardRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ chainId: String(distributionChainId), campaignId, items: String(ROW_PAGE), page: String(page) });
    const parsed = z.array(RowSchema).safeParse(await getJson(`${MERKL_API}/rewards?${params}`, fetchImpl));
    if (!parsed.success) throw new Error(`Merkl rewards of ${campaignId}: invalid response. ${z.prettifyError(parsed.error)}`);
    rows.push(...parsed.data);
    if (parsed.data.length < ROW_PAGE) return rows;
  }
  throw new Error(`Merkl rewards of ${campaignId}: more than ${MAX_PAGES} pages`);
}

/** What a reward row's reason says: the position it names, a row for no position, or something unrecognised. */
export function classifyReason(reason: string): { kind: "position"; tokenId: string } | { kind: "none" } | { kind: "unresolved" } {
  if (NON_POSITION_REASONS.has(reason)) return { kind: "none" };
  const tokenId = reason.match(/^MultiLogPerAdditionalParam_tokenId_(\d+)_/)?.[1];
  return tokenId ? { kind: "position", tokenId } : { kind: "unresolved" };
}

/** One campaign's rows summed per position, with its pending total and the sum over every row. */
export function sumCampaignRows(rows: readonly RewardRow[]) {
  const perToken = new Map<string, { amount: bigint; pending: bigint; claimed: bigint }>();
  let unresolved = 0;
  let pendingTotal = 0n;
  let allRows = 0n;
  for (const row of rows) {
    const amount = BigInt(row.amount);
    const pending = BigInt(row.pending || "0");
    pendingTotal += pending;
    allRows += amount + pending;
    const reason = classifyReason(row.reason);
    if (reason.kind === "unresolved") unresolved += 1;
    if (reason.kind !== "position") continue;
    const entry = perToken.get(reason.tokenId) ?? { amount: 0n, pending: 0n, claimed: 0n };
    entry.amount += amount;
    entry.pending += pending;
    entry.claimed += BigInt(row.claimed || "0");
    perToken.set(reason.tokenId, entry);
  }
  return { perToken, unresolved, pendingTotal, allRows };
}

/** Whether a campaign's rewards are final, given its pending total and the Distributor's dispute state. */
export function campaignIsFinal(campaign: PoolCampaign, pendingTotal: bigint, dispute: DisputeState, now: number): boolean {
  return (
    campaign.end <= now &&
    campaign.computedUntil !== null &&
    campaign.computedUntil >= campaign.end &&
    pendingTotal === 0n &&
    dispute.endOfDisputePeriod <= now &&
    /^0x0{40}$/i.test(dispute.disputer)
  );
}

/** Whole tokens from wei, without losing the integer part to float rounding. */
function whole(wei: bigint): number {
  const scale = 10n ** BigInt(TEL_DECIMALS);
  return Number(wei / scale) + Number(wei % scale) / Number(scale);
}

/** Builds the pool's index: every campaign's rows, summed per position, with each position's finality. */
export async function buildPoolRewardsIndex(chain: RpcChain, poolId: string, deps: PoolRewardsDeps): Promise<PoolRewardsIndex> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = Math.floor((deps.now ?? Date.now)() / 1000);
  const campaigns = await fetchPoolTelCampaigns(CHAIN_IDS[chain], poolId, fetchImpl);
  const disputes = new Map<number, Promise<DisputeState>>();
  const disputeOf = (chainId: number) => {
    if (!disputes.has(chainId)) disputes.set(chainId, deps.readDispute(chainId));
    return disputes.get(chainId)!;
  };

  const perCampaign = await Promise.all(
    campaigns.map(async campaign => {
      const [rows, dispute] = await Promise.all([fetchCampaignRows(campaign.distributionChainId, campaign.id, fetchImpl), disputeOf(campaign.distributionChainId)]);
      const sums = sumCampaignRows(rows);
      return { campaign, sums, final: campaignIsFinal(campaign, sums.pendingTotal, dispute, now) };
    }),
  );

  const totals = new Map<string, { amount: bigint; pending: bigint; unclaimed: bigint; final: boolean }>();
  let unresolved = 0;
  for (const { sums, final } of perCampaign) {
    unresolved += sums.unresolved;
    for (const [tokenId, { amount, pending, claimed }] of sums.perToken) {
      const entry = totals.get(tokenId) ?? { amount: 0n, pending: 0n, unclaimed: 0n, final: true };
      entry.amount += amount;
      entry.pending += pending;
      entry.unclaimed += amount > claimed ? amount - claimed : 0n;
      entry.final &&= final;
      totals.set(tokenId, entry);
    }
  }

  const positions: Record<string, PositionTel> = {};
  for (const [tokenId, { amount, pending, unclaimed, final }] of totals) {
    positions[tokenId] = { reward: whole(amount + pending), claimable: whole(unclaimed), pending: whole(pending), final };
  }
  return {
    chain,
    poolId: poolId.toLowerCase(),
    updatedAt: now,
    campaigns: perCampaign.map(({ campaign, final }) => ({ id: campaign.id, start: campaign.start, end: campaign.end, final })),
    unresolved,
    positions,
  };
}

/** How long a built index is served before it is rebuilt. */
export const POOL_REWARDS_TTL_MS = 3 * 60_000;

const cache = new Map<string, { at: number; index: Promise<PoolRewardsIndex> }>();

/**
 * The pool's index from this instance's cache, rebuilt after POOL_REWARDS_TTL_MS. Concurrent requests share one
 * build, and a failed build is dropped so the next request tries again.
 */
export function poolRewardsIndex(chain: RpcChain, poolId: string, deps: PoolRewardsDeps): Promise<PoolRewardsIndex> {
  const key = `${chain}:${poolId.toLowerCase()}`;
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(key);
  if (hit && now - hit.at < POOL_REWARDS_TTL_MS) return hit.index;
  const index = buildPoolRewardsIndex(chain, poolId, deps);
  cache.set(key, { at: now, index });
  index.catch(() => {
    if (cache.get(key)?.index === index) cache.delete(key);
  });
  return index;
}

/** Clears the cache, for tests. */
export function clearPoolRewardsCache() {
  cache.clear();
}
