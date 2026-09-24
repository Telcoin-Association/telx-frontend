/**
 * Server-side proxy for Merkl /rewards/summary API.
 * Required because browser CSP blocks direct calls to api.merkl.xyz.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  MERKL_API_BASE_URL,
  MERKL_BASE_CHAIN_ID,
  MERKL_SUPPORTED_CHAIN_IDS,
} from "@/merkl/merklConstants";

const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const ALLOWED_CHAIN_ID_BY_PARAM: Record<string, number> = Object.fromEntries(
  MERKL_SUPPORTED_CHAIN_IDS.map((id) => [String(id), id])
);

function parseEthAddress(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(ETH_ADDRESS_PATTERN);
  return match ? match[0].toLowerCase() : null;
}

function parseSupportedChainId(value: string | null): number | null {
  if (value == null) return null;
  return ALLOWED_CHAIN_ID_BY_PARAM[value] ?? null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const safeAddress = parseEthAddress(searchParams.get("userAddress"));
  const chainIdParam = searchParams.get("chainId");
  const reloadChainIdParam = searchParams.get("reloadChainId");

  if (!safeAddress) {
    return NextResponse.json(
      { error: "A valid userAddress is required" },
      { status: 400 }
    );
  }

  const safeChainId = chainIdParam
    ? parseSupportedChainId(chainIdParam)
    : MERKL_BASE_CHAIN_ID;
  if (safeChainId == null) {
    return NextResponse.json(
      { error: "Unsupported chainId" },
      { status: 400 }
    );
  }

  let safeReloadChainId: number | undefined;
  if (reloadChainIdParam) {
    const parsedReloadChainId = parseSupportedChainId(reloadChainIdParam);
    if (parsedReloadChainId == null) {
      return NextResponse.json(
        { error: "Unsupported reloadChainId" },
        { status: 400 }
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

    const response = await fetch(url, {
      // Skip Next.js cache when forcing a reload after claim
      cache: safeReloadChainId != null ? "no-store" : "default",
      next: safeReloadChainId != null ? undefined : { revalidate: 60 },
    });

    if (response.status === 404) {
      return NextResponse.json([], { status: 200 });
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Merkl API error: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
