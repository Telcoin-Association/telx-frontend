// /api/balancer-grouped

import { NextRequest } from "next/server";
import { createClient, gql, Client, cacheExchange, fetchExchange } from "@urql/core";
import { groupByPoolId } from "@/helpers/normalizeSubgraphData";

const client: Client = createClient({
  url: 'https://gateway.thegraph.com/api/subgraphs/id/H9oPAbXnobBRq1cB3HDmbZ1E8MWQyJYQjT1QDJMrdbNp',
  fetchOptions: {
    headers: {
      Authorization: `Bearer ${process.env.UNISWAP_API_KEY}`,
    },
  },
  exchanges: [cacheExchange, fetchExchange],
});

const startOfNinetyDaysAgo = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // ✅ get all poolIds
  const poolIds = searchParams.getAll("poolIds").filter(Boolean) || [];

  const DATA_QUERY = gql`
query(
  $poolIds: [String!]!
  $since: Int!
  $first: Int!
  $skip: Int!
) {
  pools(
    where: { id_in: $poolIds }
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

  threeMonthLiquidityData: poolSnapshots(
    where: { timestamp_gte: $since, pool_in: $poolIds }
     orderBy: timestamp
    orderDirection: asc
    first: $first
    skip: $skip
  ) {
    timestamp
    liquidity
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

    const groupedNormalizeData = groupByPoolId(result.data);

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







