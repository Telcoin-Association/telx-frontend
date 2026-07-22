/**
 * Server-side proxy for Merkl /rewards/summary API.
 * Required because browser CSP blocks direct calls to api.merkl.xyz.
 */

import { NextRequest, NextResponse } from "next/server";
import { MERKL_API_BASE_URL, MERKL_CHAIN_ID } from "@/merkl/merklConstants";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userAddress = searchParams.get("userAddress");
  const chainId = searchParams.get("chainId") ?? String(MERKL_CHAIN_ID);
  const reloadChainId = searchParams.get("reloadChainId");

  if (!userAddress) {
    return NextResponse.json(
      { error: "userAddress is required" },
      { status: 400 }
    );
  }

  try {
    const params = new URLSearchParams({ chainId });
    if (reloadChainId) {
      params.set("reloadChainId", reloadChainId);
    }

    const url = `${MERKL_API_BASE_URL}/users/${userAddress.toLowerCase()}/rewards/summary?${params}`;
    const response = await fetch(url, {
      // Skip Next.js cache when forcing a reload after claim
      cache: reloadChainId ? "no-store" : "default",
      next: reloadChainId ? undefined : { revalidate: 60 },
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
