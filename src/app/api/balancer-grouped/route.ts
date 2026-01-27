// /api/balancer-grouped

import { NextRequest } from "next/server";
import { createClient, gql, Client, cacheExchange, fetchExchange } from "@urql/core";
import { groupBalancerByPoolId } from "@/helpers/normalizeBalancerSubgraphData";

const client: Client = createClient({
  url: 'https://gateway.thegraph.com/api/subgraphs/id/H9oPAbXnobBRq1cB3HDmbZ1E8MWQyJYQjT1QDJMrdbNp',
  fetchOptions: {
    headers: {
      Authorization: `Bearer ${process.env.UNISWAP_API_KEY}`,
    },
  },
  exchanges: [cacheExchange, fetchExchange],
});

const oneDayInMS = 24 * 60 * 60 * 1000
const today = new Date()
const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
let startOfTwoDaysAgo = startOfToday - oneDayInMS - oneDayInMS
startOfTwoDaysAgo = Math.floor(startOfTwoDaysAgo / 1000)

const startOfNinetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // ✅ get all poolIds
  const poolIds = searchParams.getAll("poolIds").filter(Boolean) || [];

  const DATA_QUERY = gql`
    query (
  $poolIds: [String!]!
  $since: Int!
  $first: Int! = 1000
  $skip: Int! = 0
) {
  pools(
    where: {id_in: $poolIds }
  ) {
    id
    address
    totalLiquidity
    totalSwapFee
    swapFee
  }

  poolSnapshots(
    where: { timestamp_gte: $since, pool_in: $poolIds }
     orderBy: timestamp
    orderDirection: asc
    first: $first
    skip: $skip
  ) {
    timestamp
    swapFees
    swapVolume
     pool {
      address
      id
    }
  }

  quarterYearLiquidityData: poolSnapshots(
   where: { timestamp_gte: $since, pool_in: $poolIds }
     orderBy: timestamp
    orderDirection: asc
    first: $first
    skip: $skip
  ) {
    timestamp
    liquidity
     pool {
      address
      id
    }
  }

  quarterYearVolumeData: poolSnapshots(
    where: { timestamp_gte: $since, pool_in: $poolIds }
     orderBy: timestamp
    orderDirection: asc
    first: $first
    skip: $skip
  ) {
    timestamp
    swapVolume
    swapFees
     pool {
      address
      id
    }
  }
}
`;

  try {
    const result = await client.query(DATA_QUERY, { poolIds, since: startOfNinetyDaysAgo, first: 1000, skip: 0 }).toPromise();
    
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // console.log(result, "result.data-----balancer")
    const groupedNormalizeData = groupBalancerByPoolId(result.data);

    // console.log(result.data, "result.data")

    return new Response(JSON.stringify(groupedNormalizeData), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}




