import "server-only";

import { z } from "zod";

import { timestampMsOrNull } from "@/lib/timestamps";

import type { Chain } from "../registry";

/** Merkl's public API. It needs no key. */
export const MERKL_API = "https://api.merkl.xyz/v4";

/** The opportunity type Merkl gives a Uniswap v4 pool whose liquidity subscribes for rewards. */
export const OPPORTUNITY_TYPE = "UNISWAP_V4_SUBSCRIPTION";

export const CHAIN_IDS: Readonly<Record<Chain, number>> = { ethereum: 1, polygon: 137, base: 8453 };

/** Merkl's page size limit. */
export const PAGE_SIZE = 100;

/** Pages read per chain before giving up. A truncated list could drop a pool's opportunity, so it fails the run. */
export const MAX_PAGES = 10;

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Merkl sends unix seconds, as a string or a number; "0" means unset. Parsed to unix ms, or null when unset
 * or out of range (see MAX_TIMESTAMP_MS).
 */
const Timestamp = z
  .union([z.string(), z.number()])
  .nullish()
  .transform(value => {
    const seconds = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return typeof seconds === "number" ? timestampMsOrNull(seconds * 1000) : null;
  });

const Rate = z
  .number()
  .nullish()
  .transform(value => (typeof value === "number" && Number.isFinite(value) ? value : null));

/**
 * The fields of a Merkl opportunity this app reads. Unknown fields are dropped, and the optional ones
 * may be missing. `status` stays a plain string so a status Merkl adds later parses and is then ignored.
 */
export const OpportunitySchema = z.object({
  id: z.string(),
  identifier: z.string(),
  chainId: z.number(),
  type: z.string(),
  status: z.string(),
  apr: Rate,
  dailyRewards: Rate,
  tvl: Rate,
  aprRecord: z
    .object({
      breakdowns: z
        .array(
          z.object({
            identifier: z.string(),
            type: z.string(),
            value: z.number(),
            distributionType: z.string().nullish(),
          }),
        )
        .default([]),
    })
    .nullish(),
  latestCampaignStart: Timestamp,
  latestCampaignEnd: Timestamp,
});

export type Opportunity = z.infer<typeof OpportunitySchema>;

export const OpportunitiesPageSchema = z.array(OpportunitySchema);

export function opportunitiesUrl(chain: Chain, page: number): string {
  const params = new URLSearchParams({
    chainId: String(CHAIN_IDS[chain]),
    type: OPPORTUNITY_TYPE,
    items: String(PAGE_SIZE),
    page: String(page),
  });
  return `${MERKL_API}/opportunities/?${params}`;
}

/**
 * Every Uniswap v4 subscription opportunity Merkl lists for `chain`, whatever its status, read page by
 * page until a short page. Throws on an HTTP error, a response that fails validation, or more than
 * MAX_PAGES full pages, so a failed run never passes on a partial list.
 */
export async function fetchOpportunities(chain: Chain, fetchImpl: typeof fetch = fetch): Promise<Opportunity[]> {
  const all: Opportunity[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchImpl(opportunitiesUrl(chain, page), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Merkl ${chain}: HTTP ${res.status} on page ${page}`);

    const parsed = OpportunitiesPageSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`Merkl ${chain}: invalid opportunities on page ${page}. ${z.prettifyError(parsed.error)}`);

    all.push(...parsed.data);
    if (parsed.data.length < PAGE_SIZE) return all;
  }
  throw new Error(`Merkl ${chain}: more than ${MAX_PAGES} pages of ${PAGE_SIZE} opportunities`);
}
