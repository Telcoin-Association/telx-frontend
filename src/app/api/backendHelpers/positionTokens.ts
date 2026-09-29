import type { RpcChain } from "@/lib/rpc";
import { alchemyNftUrl, siteOrigin } from "./alchemy";
import { describeError } from "./errors";

/** Alchemy NFT API failure. `status` is the HTTP status, or null when no usable response came back. */
export class AlchemyNftError extends Error {
  readonly status: number | null;

  constructor(message: string, status?: number | null) {
    super(message);
    this.name = "AlchemyNftError";
    this.status = status ?? null;
  }
}

/** Largest page getNFTsForOwner serves. */
export const NFT_PAGE_SIZE = 100;
/** Pages fetched per wallet before giving up, so a pageKey that never ends cannot loop forever. */
export const NFT_MAX_PAGES = 20;

/** Enumerations per lookup when the list comes back shorter than `expectedCount`. */
export const NFT_MAX_ATTEMPTS = 3;

/** Longest a single getNFTsForOwner page may take. */
export const NFT_PAGE_TIMEOUT_MS = 10_000;
/** Overall budget for one lookup, retries included, when the caller passes no deadline. */
export const NFT_LOOKUP_BUDGET_MS = 15_000;

export type ListOwnedTokenIdsOptions = {
  chain: RpcChain;
  owner: string;
  contract: string;
  fetchImpl?: typeof fetch;
  /** On-chain balanceOf(owner) for `contract`. When given, a list shorter than it is fetched again, up to NFT_MAX_ATTEMPTS times. */
  expectedCount?: () => Promise<number>;
  /** Pause between attempts; tests pass 0. */
  retryDelayMs?: number;
  /** Epoch milliseconds after which no further page is requested. Defaults to NFT_LOOKUP_BUDGET_MS from the call. */
  deadline?: number;
  /** Clock for the deadline; tests pass a fake one. */
  now?: () => number;
};

/**
 * Token ids from one lookup. `truncated` is true when the listing stopped early, at NFT_MAX_PAGES or at the
 * deadline, so `ids` is a known-incomplete part of the wallet.
 */
export type OwnedTokenIds = { ids: string[]; truncated: boolean };

type OwnedNftsPage = { ownedNfts: { contractAddress?: unknown; tokenId?: unknown }[]; pageKey?: unknown };

async function fetchPage(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<OwnedNftsPage> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Origin: siteOrigin() },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new AlchemyNftError(`Alchemy getNFTsForOwner request failed: ${describeError(error)}`, null);
  }
  if (!response.ok) throw new AlchemyNftError(`Alchemy getNFTsForOwner responded ${response.status}`, response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new AlchemyNftError(`Alchemy getNFTsForOwner body is not JSON: ${describeError(error)}`, null);
  }
  if (typeof body !== "object" || body === null || !Array.isArray((body as { ownedNfts?: unknown }).ownedNfts)) {
    throw new AlchemyNftError("Alchemy getNFTsForOwner response has no ownedNfts array", null);
  }
  return body as OwnedNftsPage;
}

type Enumeration = { chain: RpcChain; owner: string; contract: string; fetchImpl: typeof fetch; deadline: number; now: () => number };

/**
 * One full getNFTsForOwner enumeration, following pageKey up to NFT_MAX_PAGES pages or until the deadline.
 * Each page's timeout is capped by the time left, so the enumeration ends by the deadline. When no time is
 * left for the first page it throws, because an empty list would read as an empty wallet.
 */
async function enumerateOwnedTokenIds({ chain, owner, contract, fetchImpl, deadline, now }: Enumeration): Promise<OwnedTokenIds> {
  const wanted = contract.toLowerCase();
  const ids = new Set<string>();
  let pageKey: string | undefined;

  for (let page = 0; page < NFT_MAX_PAGES; page++) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      if (page === 0) throw new AlchemyNftError("Alchemy getNFTsForOwner lookup ran out of time", null);
      console.warn(`Alchemy getNFTsForOwner ran out of time after ${page} pages for ${owner} on ${chain}; token ids may be incomplete`);
      return { ids: [...ids], truncated: true };
    }

    const params = new URLSearchParams({
      owner,
      "contractAddresses[]": contract,
      withMetadata: "false",
      pageSize: String(NFT_PAGE_SIZE),
    });
    if (pageKey) params.set("pageKey", pageKey);

    const body = await fetchPage(`${alchemyNftUrl(chain, "getNFTsForOwner")}?${params}`, fetchImpl, Math.min(NFT_PAGE_TIMEOUT_MS, remaining));
    for (const nft of body.ownedNfts) {
      const { contractAddress, tokenId } = nft ?? {};
      if (typeof contractAddress !== "string" || contractAddress.toLowerCase() !== wanted) continue;
      if (typeof tokenId === "string" && /^\d+$/.test(tokenId)) ids.add(tokenId);
    }

    pageKey = typeof body.pageKey === "string" && body.pageKey !== "" ? body.pageKey : undefined;
    if (!pageKey) return { ids: [...ids], truncated: false };
  }

  console.warn(`Alchemy getNFTsForOwner stopped after ${NFT_MAX_PAGES} pages for ${owner} on ${chain}; token ids may be incomplete`);
  return { ids: [...ids], truncated: true };
}

/**
 * Token ids (decimal strings) of the ERC-721 `contract` owned by `owner`, from Alchemy getNFTsForOwner.
 *
 * Alchemy's index can lag and return part of the wallet with no error. With `expectedCount`, a list
 * shorter than that count is fetched again while the deadline allows; a list that stays short is returned
 * with a warning. A truncated list is short by construction, so it skips the count check and the retries.
 */
export async function listOwnedTokenIds({
  chain,
  owner,
  contract,
  fetchImpl = fetch,
  expectedCount,
  retryDelayMs = 500,
  now = Date.now,
  deadline = now() + NFT_LOOKUP_BUDGET_MS,
}: ListOwnedTokenIdsOptions): Promise<OwnedTokenIds> {
  const enumeration: Enumeration = { chain, owner, contract, fetchImpl, deadline, now };
  const first = await enumerateOwnedTokenIds(enumeration);
  if (!expectedCount || first.truncated) return first;

  let expected: number;
  try {
    expected = await expectedCount();
  } catch (error) {
    console.warn(`On-chain token count check failed for ${owner} on ${chain}; using Alchemy's list unchecked: ${describeError(error)}`);
    return first;
  }
  if (first.ids.length >= expected) return first;

  let best = first.ids;
  for (let attempt = 2; attempt <= NFT_MAX_ATTEMPTS; attempt++) {
    if (deadline - now() <= retryDelayMs) break;
    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    let result: OwnedTokenIds;
    try {
      result = await enumerateOwnedTokenIds(enumeration);
    } catch (error) {
      if (!(error instanceof AlchemyNftError)) throw error;
      console.warn(
        `Alchemy getNFTsForOwner retry failed for ${owner} on ${chain} (${error.message}); returning ${best.length} of ${expected} tokens`,
      );
      return { ids: best, truncated: false };
    }
    if (result.ids.length >= expected) return result;
    if (result.truncated) return result.ids.length >= best.length ? result : { ids: best, truncated: false };
    if (result.ids.length >= best.length) best = result.ids;
  }

  console.warn(`Alchemy getNFTsForOwner returned ${best.length} of ${expected} tokens for ${owner} on ${chain}; positions may be missing`);
  return { ids: best, truncated: false };
}
