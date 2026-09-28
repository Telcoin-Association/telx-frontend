// app/api/uniswap-user-positions-polygon/route.ts

import { NextRequest, NextResponse } from "next/server";
import { isAddress, toHex } from "viem";
import { POLYGON_POSITION_MANAGER, getUniswapChainAddresses } from "@/lib/contracts";
import { formatUnits } from 'viem'
import { publicClientPolygon } from "../backendHelpers/alchemy";
import { AlchemyNftError, listOwnedTokenIds } from "../backendHelpers/positionTokens";
import { findUniswapV4Pool } from "../backendHelpers/uniswapPools";
import { describeError } from "../backendHelpers/errors";
import { decodePositionInfo, formatSqrtPriceX96, positionManagerAbi, positionRegistryAbi } from "../backendHelpers/helpers";

export type Position = {
  tokenId: string;
  isSubscribed: boolean;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amounts: {
    amount0: string;
    amount1: string;
    sqrtPriceX96: string;
  };
  price: {
    price1Per0: number;
    price0Per1: number;
  };
};

// ----------------------
// Main API Handler
// ----------------------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolAddress = searchParams.get("poolAddress");
  const userAddress = searchParams.get("userAddress");

  if (!poolAddress || !userAddress) {
    return NextResponse.json(
      { error: "Missing userAddress or poolAddress" },
      { status: 400 }
    );
  }

  if (!isAddress(userAddress)) {
    return NextResponse.json({ error: "Invalid userAddress" }, { status: 400 });
  }

  // Token decimals come from the registry. Older clients also send amount0Decimals and amount1Decimals,
  // which are ignored.
  const pool = findUniswapV4Pool("polygon", poolAddress);
  if (!pool) {
    return NextResponse.json({ error: "Unknown poolAddress" }, { status: 400 });
  }

  // Normalize the target poolId to compare (first 25 bytes = 0x + 50 chars)
  const targetPoolId = pool.poolId.toLowerCase().slice(0, 52);
  const { positionRegistry } = getUniswapChainAddresses("polygon", pool.poolId);

  try {
    // 1. Token ids owned by the user, from Alchemy getNFTsForOwner on the PositionManager
    let tokenIds: string[];
    try {
      tokenIds = await listOwnedTokenIds({
        chain: "polygon",
        owner: userAddress,
        contract: POLYGON_POSITION_MANAGER,
        expectedCount: () =>
          publicClientPolygon
            .readContract({ address: POLYGON_POSITION_MANAGER, abi: positionManagerAbi, functionName: "balanceOf", args: [userAddress as `0x${string}`] })
            .then(Number),
      });
    } catch (e) {
      if (e instanceof AlchemyNftError) {
        console.error("Polygon position lookup failed:", describeError(e));
        return NextResponse.json({ error: "Position lookup failed" }, { status: 502 });
      }
      throw e;
    }
    const allPositions = tokenIds.map((tokenId) => ({ tokenId }));

    const matchingPositions: Position[] = [];

    let claimableAmount = 0n;
    try {
      claimableAmount = await publicClientPolygon.readContract({
        address: positionRegistry,
        abi: positionRegistryAbi,
        functionName: "unclaimedRewards",
        args: [userAddress as `0x${string}`],
      }) as bigint;
    } catch (e) {
      console.warn("Failed to read Polygon unclaimed rewards:", describeError(e));
    }
    // Markus' solution: Multiply by factor before division
    const factor = BigInt(1e6); // 1,000,000 - adjust based on needed precision

    // Multiply first, then divide
    const multipliedAmount = claimableAmount * factor;
    const dividedAmount = multipliedAmount / BigInt(1e18);

    // Convert to number and divide by the factor to get final decimal value
    const readableClaimable = Number(dividedAmount) / Number(factor);

    // 2. Loop and check each position against the contract (as requested)
    for (const position of allPositions) {
      try {
        const tokenId = BigInt(position.tokenId);

        //  2️⃣ Decode ticks
        // 3. Call positionInfo(tokenId) and isTokenSubscribed
        const positionInfoWord = await publicClientPolygon.readContract({
          address: POLYGON_POSITION_MANAGER,
          abi: positionManagerAbi,
          functionName: "positionInfo",
          args: [tokenId],
        });

        const positionLiquidity = await publicClientPolygon.readContract({
          address: POLYGON_POSITION_MANAGER,
          abi: positionManagerAbi,
          functionName: "getPositionLiquidity",
          args: [tokenId],
        });

        const decoded = decodePositionInfo(positionInfoWord);
        const tickLower = decoded.getTickLower();
        const tickUpper = decoded.getTickUpper();

        const isSubscribed = await publicClientPolygon.readContract({
          address: positionRegistry,
          abi: positionRegistryAbi,
          functionName: "isTokenSubscribed",
          args: [tokenId],
        });

        // 4. Convert bigint to 32-byte hex string
        const hexWord = toHex(positionInfoWord, { size: 32 });

        // 5. Extract first 25 bytes (0x + 50 chars = 52)
        const extractedPoolId = hexWord.slice(0, 52);

        // 3️⃣ Get liquidity
        const [amount0, amount1, sqrtPriceX96] = await publicClientPolygon.readContract({
          address: positionRegistry,
          abi: positionRegistryAbi,
          functionName: "getAmountsForLiquidity",
          args: [pool.poolId, positionLiquidity, tickLower, tickUpper],
        });

        const _amount0 = formatUnits(amount0, pool.amount0Decimals)
        const _amount1 = formatUnits(amount1, pool.amount1Decimals)
        const price1Per0 = formatSqrtPriceX96(sqrtPriceX96, pool.amount0Decimals, pool.amount1Decimals);
        const price0Per1 = formatSqrtPriceX96(sqrtPriceX96, pool.amount1Decimals, pool.amount0Decimals);

        // 6. Compare and collect matches
        if (extractedPoolId === targetPoolId) {
          // ✅ Only include positions with non-zero liquidity
          // if (Number(positionLiquidity) > 0) {
          matchingPositions.push({
            tokenId: position.tokenId,
            isSubscribed,
            tickLower,
            tickUpper,
            liquidity: positionLiquidity.toString(),
            amounts: {
              amount0: _amount0.toString(),
              amount1: _amount1.toString(),
              sqrtPriceX96: sqrtPriceX96.toString(),
            },
            price: {
              price1Per0,
              price0Per1,
            },
          });
          // }
        }
      } catch (e) {
        // Silently ignore errors (e.g., stale tokenId not in contract)
        console.warn(`Failed to read info for tokenId ${position.tokenId}:`, describeError(e));
      }
    }

    return NextResponse.json({
      positions: matchingPositions,
      claimableAmount: readableClaimable.toString()
    }, { status: 200 });
  } catch (error) {
    console.error("Polygon positions request failed:", describeError(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}