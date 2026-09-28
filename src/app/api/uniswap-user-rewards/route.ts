// app/api/uniswap-user-rewards/route.ts

import { NextRequest, NextResponse } from "next/server";
import { formatUnits, isAddress } from "viem";
import { BASE_POSITION_REGISTRY, ETHEREUM_POSITION_REGISTRY, POLYGON_POSITION_REGISTRY } from "@/lib/contracts";
import { publicClientBase, publicClientEthereum, publicClientPolygon } from "../backendHelpers/alchemy";
import { positionRegistryAbi } from "../backendHelpers/helpers";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userAddress = searchParams.get("userAddress");

  if (!userAddress || !isAddress(userAddress)) {
    return NextResponse.json({ error: "Invalid userAddress" }, { status: 400 });
  }

  try {
    const [ethereumResult, baseResult, polygonResult] = await Promise.allSettled([
      publicClientEthereum.readContract({
        address: ETHEREUM_POSITION_REGISTRY,
        abi: positionRegistryAbi,
        functionName: "unclaimedRewards",
        args: [userAddress],
      }),
      publicClientBase.readContract({
        address: BASE_POSITION_REGISTRY,
        abi: positionRegistryAbi,
        functionName: "unclaimedRewards",
        args: [userAddress],
      }),
      publicClientPolygon.readContract({
        address: POLYGON_POSITION_REGISTRY,
        abi: positionRegistryAbi,
        functionName: "unclaimedRewards",
        args: [userAddress],
      }),
    ]);

    // A chain whose read failed is null rather than "0", so the client can tell "unavailable" from "no rewards".
    const toReadable = (result: PromiseSettledResult<bigint>): string | null => {
      if (result.status !== "fulfilled") {
        console.warn("Failed to fetch uniswap unclaimed rewards:", result.reason);
        return null;
      }
      return formatUnits(result.value, Number(2));
    };

    return NextResponse.json({
      claimableAmount: {
        ethereum: toReadable(ethereumResult),
        base: toReadable(baseResult),
        polygon: toReadable(polygonResult),
      }
    }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}