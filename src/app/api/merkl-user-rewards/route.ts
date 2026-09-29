/**
 * Server-side proxy for Merkl /rewards/summary API.
 * Required because browser CSP blocks direct calls to api.merkl.xyz.
 *
 * Before answering, it raises each reward's `claimed` on the requested chain to the Merkl Distributor's
 * onchain amount, because Merkl's index can trail a claim by minutes. When the chain read fails, the body
 * goes out as Merkl sent it.
 *
 * Nothing is cached, neither Merkl's answer nor ours. Next's data cache serves an expired entry of any age
 * while it revalidates in the background, so a cached copy can predate a claim and show claimed rewards as
 * claimable again on the next page load. The body is per user as well.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiPreviewRejection } from "@/helpers/previewAuth";
import { applyClaimedAmounts, readClaimedAmounts, type ClaimedReader } from "@/merkl/merklClaimed";
import {
  MERKL_API_BASE_URL,
  MERKL_BASE_CHAIN_ID,
  MERKL_ETHEREUM_CHAIN_ID,
  MERKL_POLYGON_CHAIN_ID,
  MERKL_SUPPORTED_CHAIN_IDS,
} from "@/merkl/merklConstants";
import type { MerklChainRewardsResponse } from "@/merkl/merklTypes";
import { publicClientBase, publicClientEthereum, publicClientPolygon } from "../backendHelpers/alchemy";
import { describeError } from "../backendHelpers/errors";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const ALLOWED_CHAIN_ID_BY_PARAM: Record<string, number> = Object.fromEntries(
  MERKL_SUPPORTED_CHAIN_IDS.map((id) => [String(id), id])
);

/** Server clients that read the Distributor's `claimed` view, by chain id. */
const CLAIMED_READERS: Record<number, ClaimedReader> = {
  [MERKL_ETHEREUM_CHAIN_ID]: publicClientEthereum,
  [MERKL_BASE_CHAIN_ID]: publicClientBase,
  [MERKL_POLYGON_CHAIN_ID]: publicClientPolygon,
};

function parseEthAddress(value: string | null): `0x${string}` | null {
  if (!value) return null;
  const match = value.match(ETH_ADDRESS_PATTERN);
  return match ? (match[0].toLowerCase() as `0x${string}`) : null;
}

function parseSupportedChainId(value: string | null): number | null {
  if (value == null) return null;
  return ALLOWED_CHAIN_ID_BY_PARAM[value] ?? null;
}

/**
 * Merkl's body with `claimed` on the `chainId` entry raised to what the Distributor reports for `user`.
 * Reads that fail are logged and leave Merkl's values in place.
 */
async function withOnchainClaimed(data: unknown, chainId: number, user: `0x${string}`): Promise<unknown> {
  const client = CLAIMED_READERS[chainId];
  if (!Array.isArray(data) || !client) return data;

  const entries = data as MerklChainRewardsResponse[];
  const rewards = entries.find((entry) => entry?.chain?.id === chainId)?.rewards;
  const tokens = Array.isArray(rewards) ? rewards.map((reward) => reward?.token?.address) : [];
  if (tokens.length === 0) return data;

  const { claimed, failures } = await readClaimedAmounts(client, user, tokens);
  for (const failure of failures) {
    console.warn("Merkl claimed read failed:", describeError(failure));
  }
  return applyClaimedAmounts(entries, { [chainId]: claimed });
}

export async function GET(req: NextRequest) {
  const previewRejected = await apiPreviewRejection(req);
  if (previewRejected) return previewRejected;

  const { searchParams } = new URL(req.url);
  const safeAddress = parseEthAddress(searchParams.get("userAddress"));
  const chainIdParam = searchParams.get("chainId");
  const reloadChainIdParam = searchParams.get("reloadChainId");

  if (!safeAddress) {
    return NextResponse.json(
      { error: "A valid userAddress is required" },
      { status: 400, headers: NO_STORE }
    );
  }

  const safeChainId = chainIdParam
    ? parseSupportedChainId(chainIdParam)
    : MERKL_BASE_CHAIN_ID;
  if (safeChainId == null) {
    return NextResponse.json(
      { error: "Unsupported chainId" },
      { status: 400, headers: NO_STORE }
    );
  }

  let safeReloadChainId: number | undefined;
  if (reloadChainIdParam) {
    const parsedReloadChainId = parseSupportedChainId(reloadChainIdParam);
    if (parsedReloadChainId == null) {
      return NextResponse.json(
        { error: "Unsupported reloadChainId" },
        { status: 400, headers: NO_STORE }
      );
    }
    safeReloadChainId = parsedReloadChainId;
  }

  try {
    const url = new URL(
      `users/${encodeURIComponent(safeAddress)}/rewards/summary`,
      `${MERKL_API_BASE_URL}/`
    );
    url.searchParams.set("chainId", String(safeChainId));
    if (safeReloadChainId != null) {
      url.searchParams.set("reloadChainId", String(safeReloadChainId));
    }

    // Always fresh: Next serves an expired cache entry of any age while it revalidates, which can predate a claim.
    const response = await fetch(url, { cache: "no-store" });

    if (response.status === 404) {
      return NextResponse.json([], { status: 200, headers: NO_STORE });
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Merkl API error: ${response.status} ${response.statusText}` },
        { status: response.status, headers: NO_STORE }
      );
    }

    const data = await response.json();
    return NextResponse.json(await withOnchainClaimed(data, safeChainId, safeAddress), {
      status: 200,
      headers: NO_STORE,
    });
  } catch (error) {
    console.error("Merkl rewards request failed:", describeError(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
