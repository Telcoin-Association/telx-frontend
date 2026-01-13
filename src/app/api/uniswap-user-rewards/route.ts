// app/api/uniswap-user-rewards/route.ts

import { NextRequest, NextResponse } from "next/server";
import { formatUnits } from "viem";
import { BASE_POSITION_REGISTRY, POLYGON_POSITION_REGISTRY } from "@/lib/contracts";
import { positionRegistryAbi, publicClientBase, publicClientPolygon } from "../backendHelpers/helpers";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userAddress = searchParams.get("userAddress");

  try {
    const claimableAmountBase = await publicClientBase.readContract({
      address: BASE_POSITION_REGISTRY,
      abi: positionRegistryAbi,
      functionName: "unclaimedRewards",
      args: [userAddress as `0x${string}`],
    });

    const claimableAmountPolygon = await publicClientPolygon.readContract({
      address: POLYGON_POSITION_REGISTRY,
      abi: positionRegistryAbi,
      functionName: "unclaimedRewards",
      args: [userAddress as `0x${string}`],
    });

    const readableClaimableAmountBase = formatUnits(claimableAmountBase, Number(2))
    const readableClaimableAmountPolygon = formatUnits(claimableAmountPolygon, Number(2))

    return NextResponse.json({
      claimableAmount: { base: readableClaimableAmountBase, polygon: readableClaimableAmountPolygon }
    }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}