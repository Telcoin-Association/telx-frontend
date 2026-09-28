// app/api/uniswap-user-positions-polygon/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient, gql, Client, cacheExchange, fetchExchange } from "@urql/core";
import { toHex } from "viem";
import { POLYGON_POSITION_MANAGER, getUniswapChainAddresses } from "@/lib/contracts";
import { formatUnits } from 'viem'
import { decodePositionInfo, formatSqrtPriceX96, positionManagerAbi, positionRegistryAbi, publicClientPolygon } from "../backendHelpers/helpers";

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
// Setup Clients
// ----------------------
const client: Client = createClient({
  url: "https://gateway.thegraph.com/api/subgraphs/id/CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND",
  fetchOptions: {
    headers: {
      Authorization: `Bearer ${process.env.UNISWAP_API_KEY}`,
    },
  },
  exchanges: [cacheExchange, fetchExchange],
});

// ----------------------
// Main API Handler
// ----------------------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolAddress = searchParams.get("poolAddress");
  const userAddress = searchParams.get("userAddress");
  const amount0Decimals = searchParams.get("amount0Decimals");
  const amount1Decimals = searchParams.get("amount1Decimals");

  if (!poolAddress || !userAddress) {
    return NextResponse.json(
      { error: "Missing userAddress or poolAddress" },
      { status: 400 }
    );
  }

  // Normalize the target poolId to compare (first 25 bytes = 0x + 50 chars)
  const targetPoolId = poolAddress.toLowerCase().slice(0, 52);
  const { positionRegistry } = getUniswapChainAddresses("polygon", poolAddress);

  const DATA_QUERY = gql`
    query GetUserPositions($owner: String!) {
      positions(where: { owner: $owner }) {
        tokenId
      }
    }
  `;

  try {
    // 1. Fetch all positions from subgraph
    const result = await client.query(DATA_QUERY, { owner: userAddress.toLowerCase() }).toPromise();

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    const allPositions = result.data?.positions;

    if (!allPositions) {
      return NextResponse.json({ positions: [] }, { status: 200 });
    }

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
      console.warn("Failed to read Polygon unclaimed rewards:", e);
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
          args: [poolAddress as `0x${string}`, positionLiquidity, tickLower, tickUpper],
        });

        const _amount0 = formatUnits(amount0, Number(amount0Decimals))
        const _amount1 = formatUnits(amount1, Number(amount1Decimals))
        const price1Per0 = formatSqrtPriceX96(sqrtPriceX96, Number(amount0Decimals), Number(amount1Decimals));
        const price0Per1 = formatSqrtPriceX96(sqrtPriceX96, Number(amount1Decimals), Number(amount0Decimals));

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
        console.warn(`Failed to read info for tokenId ${position.tokenId}:`, e);
      }
    }

    return NextResponse.json({
      positions: matchingPositions,
      claimableAmount: readableClaimable.toString()
    }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}