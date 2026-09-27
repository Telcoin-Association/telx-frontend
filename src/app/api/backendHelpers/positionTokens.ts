import type { RpcChain } from "@/lib/rpc";
import { alchemyNftUrl, siteOrigin } from "./alchemy";

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

export type ListOwnedTokenIdsOptions = {
  chain: RpcChain;
  owner: string;
  contract: string;
  fetchImpl?: typeof fetch;
  /** On-chain balanceOf(owner) for `contract`. When given, a list shorter than it is fetched again, up to NFT_MAX_ATTEMPTS times. */
  expectedCount?: () => Promise<number>;
  /** Pause between attempts; tests pass 0. */
  retryDelayMs?: number;
};

type OwnedNftsPage = { ownedNfts: { contractAddress?: unknown; tokenId?: unknown }[]; pageKey?: unknown };

async function fetchPage(url: string, fetchImpl: typeof fetch): Promise<OwnedNftsPage> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Origin: siteOrigin() },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new AlchemyNftError(`Alchemy getNFTsForOwner request failed: ${errorMessage(error)}`, null);
  }
  if (!response.ok) throw new AlchemyNftError(`Alchemy getNFTsForOwner responded ${response.status}`, response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new AlchemyNftError(`Alchemy getNFTsForOwner body is not JSON: ${errorMessage(error)}`, null);
  }
  if (typeof body !== "object" || body === null || !Array.isArray((body as { ownedNfts?: unknown }).ownedNfts)) {
    throw new AlchemyNftError("Alchemy getNFTsForOwner response has no ownedNfts array", null);
  }
  return body as OwnedNftsPage;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One full getNFTsForOwner enumeration, following pageKey up to NFT_MAX_PAGES pages. */
async function enumerateOwnedTokenIds(chain: RpcChain, owner: string, contract: string, fetchImpl: typeof fetch): Promise<string[]> {
  const wanted = contract.toLowerCase();
  const ids = new Set<string>();
  let pageKey: string | undefined;

  for (let page = 0; page < NFT_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      owner,
      "contractAddresses[]": contract,
      withMetadata: "false",
      pageSize: String(NFT_PAGE_SIZE),
    });
    if (pageKey) params.set("pageKey", pageKey);

    const body = await fetchPage(`${alchemyNftUrl(chain, "getNFTsForOwner")}?${params}`, fetchImpl);
    for (const nft of body.ownedNfts) {
      const { contractAddress, tokenId } = nft ?? {};
      if (typeof contractAddress !== "string" || contractAddress.toLowerCase() !== wanted) continue;
      if (typeof tokenId === "string" && /^\d+$/.test(tokenId)) ids.add(tokenId);
    }

    pageKey = typeof body.pageKey === "string" && body.pageKey !== "" ? body.pageKey : undefined;
    if (!pageKey) return [...ids];
  }

  console.warn(`Alchemy getNFTsForOwner stopped after ${NFT_MAX_PAGES} pages for ${owner} on ${chain}; token ids may be incomplete`);
  return [...ids];
}

/**
 * Token ids (decimal strings) of the ERC-721 `contract` owned by `owner`, from Alchemy getNFTsForOwner.
 *
 * Alchemy's index can lag and return part of the wallet with no error. With `expectedCount`, a list
 * shorter than that count is fetched again; a list that stays short is returned with a warning.
 */
export async function listOwnedTokenIds({
  chain,
  owner,
  contract,
  fetchImpl = fetch,
  expectedCount,
  retryDelayMs = 500,
}: ListOwnedTokenIdsOptions): Promise<string[]> {
  const first = await enumerateOwnedTokenIds(chain, owner, contract, fetchImpl);
  if (!expectedCount) return first;

  let expected: number;
  try {
    expected = await expectedCount();
  } catch (error) {
    console.warn(`On-chain token count check failed for ${owner} on ${chain}; using Alchemy's list unchecked: ${errorMessage(error)}`);
    return first;
  }
  if (first.length >= expected) return first;

  let best = first;
  for (let attempt = 2; attempt <= NFT_MAX_ATTEMPTS; attempt++) {
    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    let ids: string[];
    try {
      ids = await enumerateOwnedTokenIds(chain, owner, contract, fetchImpl);
    } catch (error) {
      if (!(error instanceof AlchemyNftError)) throw error;
      console.warn(
        `Alchemy getNFTsForOwner retry failed for ${owner} on ${chain} (${error.message}); returning ${best.length} of ${expected} tokens`,
      );
      return best;
    }
    if (ids.length >= expected) return ids;
    if (ids.length >= best.length) best = ids;
  }

  console.warn(
    `Alchemy getNFTsForOwner returned ${best.length} of ${expected} tokens for ${owner} on ${chain} after ${NFT_MAX_ATTEMPTS} attempts; positions may be missing`,
  );
  return best;
}
