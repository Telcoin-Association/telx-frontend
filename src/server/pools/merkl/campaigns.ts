import "server-only";

import { z } from "zod";

import { DAY } from "../rpc/buckets";
import type { Chain, RpcPool } from "../registry";
import { fetchOpportunities, MERKL_API, OPPORTUNITY_TYPE, type Opportunity } from "./fetch";
import { opportunityIdentifierOf } from "./match";

/**
 * A Merkl campaign on one of our pools, as its creator funded it: `amount` whole reward tokens spread evenly
 * over `[start, end)` (unix seconds). Merkl reports each campaign's daily rewards as this amount over its
 * duration, priced at the reward token's current price.
 */
export type Campaign = {
  /** Merkl's on-chain campaign id, the same id the opportunity's APR breakdown names. */
  id: string;
  poolId: string;
  start: number;
  end: number;
  amount: number;
  /** Lowercase reward token address. */
  token: string;
  symbol: string;
  /** The reward token's current USD price as Merkl reports it, or null. */
  priceUSD: number | null;
};

const Seconds = z.union([z.string(), z.number()]).transform(value => Number(value));

const CampaignSchema = z.object({
  campaignId: z.string(),
  startTimestamp: Seconds,
  endTimestamp: Seconds,
  amount: z.string(),
  rewardToken: z.object({
    address: z.string(),
    decimals: z.number().int().nonnegative(),
    symbol: z.string(),
    price: z.number().nullish(),
  }),
});

const CampaignsPageSchema = z.array(CampaignSchema);

const FETCH_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100;

export function campaignsUrl(opportunityId: string): string {
  const params = new URLSearchParams({ opportunityId, items: String(PAGE_SIZE) });
  return `${MERKL_API}/campaigns?${params}`;
}

/** A raw token amount in whole tokens, without losing the integer part to float rounding first. */
function wholeTokens(raw: string, decimals: number): number {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  return Number(value / scale) + Number(value % scale) / Number(scale);
}

/** One opportunity's campaigns, whatever their status. Throws on an HTTP error or a response that fails validation. */
export async function fetchCampaignsOf(opportunity: Pick<Opportunity, "id">, poolId: string, fetchImpl: typeof fetch = fetch): Promise<Campaign[]> {
  const res = await fetchImpl(campaignsUrl(opportunity.id), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Merkl campaigns of ${opportunity.id}: HTTP ${res.status}`);
  const parsed = CampaignsPageSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`Merkl campaigns of ${opportunity.id}: invalid response. ${z.prettifyError(parsed.error)}`);
  if (parsed.data.length >= PAGE_SIZE) throw new Error(`Merkl campaigns of ${opportunity.id}: ${PAGE_SIZE} or more campaigns, the list may be truncated`);
  return parsed.data
    .filter(campaign => campaign.endTimestamp > campaign.startTimestamp)
    .map(campaign => ({
      id: campaign.campaignId.toLowerCase(),
      poolId,
      start: campaign.startTimestamp,
      end: campaign.endTimestamp,
      amount: wholeTokens(campaign.amount, campaign.rewardToken.decimals),
      token: campaign.rewardToken.address.toLowerCase(),
      symbol: campaign.rewardToken.symbol,
      priceUSD: typeof campaign.rewardToken.price === "number" && campaign.rewardToken.price > 0 ? campaign.rewardToken.price : null,
    }));
}

/** Every campaign Merkl lists on `pools`, matched by the opportunity identifier (the pool id's low 20 bytes). */
export async function fetchPoolCampaigns(chain: Chain, pools: readonly RpcPool[], fetchImpl: typeof fetch = fetch): Promise<Campaign[]> {
  const byIdentifier = new Map(pools.map(pool => [opportunityIdentifierOf(pool.id), pool.id] as const));
  const opportunities = (await fetchOpportunities(chain, fetchImpl)).filter(
    opportunity => opportunity.type === OPPORTUNITY_TYPE && byIdentifier.has(opportunity.identifier.toLowerCase()),
  );
  const lists = await Promise.all(
    opportunities.map(opportunity => fetchCampaignsOf(opportunity, byIdentifier.get(opportunity.identifier.toLowerCase()) as string, fetchImpl)),
  );
  return lists.flat();
}

/** The share of `campaign` that falls in the UTC day starting at `day`: its overlap with the day over its duration. */
export function campaignShareOfDay(campaign: Pick<Campaign, "start" | "end">, day: number): number {
  const overlap = Math.min(campaign.end, day + DAY) - Math.max(campaign.start, day);
  return overlap > 0 ? overlap / (campaign.end - campaign.start) : 0;
}

/** The campaigns that distribute anything during the UTC day starting at `day`. */
export const campaignsOnDay = (campaigns: readonly Campaign[], day: number) => campaigns.filter(campaign => campaignShareOfDay(campaign, day) > 0);
