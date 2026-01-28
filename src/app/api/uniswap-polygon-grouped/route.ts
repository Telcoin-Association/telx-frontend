// app/api/uniswap-polygon-grouped/route.ts

import { NextRequest } from "next/server";
import { createClient, gql, Client, cacheExchange, fetchExchange } from "@urql/core";
import { groupByPoolId } from "@/helpers/normalizeSubgraphData";

const client: Client = createClient({
  url: 'https://gateway.thegraph.com/api/subgraphs/id/CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND',
  fetchOptions: {
    headers: {
      Authorization: `Bearer ${process.env.UNISWAP_API_KEY}`,
    },
  },
  exchanges: [cacheExchange, fetchExchange],
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // ✅ get all poolIds
  const poolIds = searchParams.getAll("poolIds").filter(Boolean) || [];
  const now = Date.now(); // milliseconds
  const twentyFourHoursAgo = Math.floor((now - 24 * 60 * 60 * 1000) / 1000).toString(); // convert to seconds

  const DATA_QUERY = gql`
    query ($poolIds: [String!]!, $number: Int!, $numberBy90: Int!){
  pools(
    where: {id_in: $poolIds}
  ) {
    id
    totalValueLockedUSD
    feesUSD
  }
  poolSnapshots: poolHourDatas(
    where: {pool_in: $poolIds, periodStartUnix_gt: ${twentyFourHoursAgo} }
    first: $number
    orderBy: periodStartUnix
    orderDirection: desc
  ) {
     pool {id}
    periodStartUnix
    volumeUSD
    feesUSD
    
  }
  quarterYearVolumeData: poolHourDatas(
    where: {pool_in: $poolIds}
    first: $numberBy90
    orderBy: periodStartUnix
    orderDirection: desc
  ) {
     pool {id}
    periodStartUnix
    volumeUSD
    feesUSD
    tvlUSD
  }
  quarterYearLiquidityData: poolDayDatas(
    where: {pool_in: $poolIds}
    first: $numberBy90
    orderBy: date
    orderDirection: desc
  ) {
     pool {id}
    timestamp: date
    tvlUSD
    volumeUSD
}
}
`;

  try {
    const result = await client.query(DATA_QUERY, { poolIds, number: poolIds.length * 48, numberBy90: 91 * poolIds.length }).toPromise();
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