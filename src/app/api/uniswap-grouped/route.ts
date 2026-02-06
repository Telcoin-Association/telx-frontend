// app/api/uniswap-base-grouped/route.ts

import { NextRequest } from "next/server";
import { createClient, gql, Client, cacheExchange, fetchExchange } from "@urql/core";
import { groupByPoolId } from "@/helpers/normalizeSubgraphData";


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const chain = searchParams.get('chain')
  let subgraphId;
  const base = "Gqm2b5J85n1bhCyDMpGbtbVn4935EvvdyHdHrx3dibyj"
  const polygon = "CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND"

  if (chain === 'base') {
    subgraphId = base
  } else if (chain === "polygon") {
    subgraphId = polygon
  } else {
    console.log("chain Parameter missing in the Uniswap subgraph API")
    return;
  }

  const client: Client = createClient({
    url: `https://gateway.thegraph.com/api/subgraphs/id/${subgraphId}`,
    fetchOptions: {
      headers: {
        Authorization: `Bearer ${process.env.UNISWAP_API_KEY}`,
      },
    },
    exchanges: [cacheExchange, fetchExchange],
  });
  // get all poolIds
  const poolIds = searchParams.getAll("poolIds").filter(Boolean) || [];

  // pairDayDatas.date is usually unix seconds at day start
  const nowSec = Math.floor(Date.now() / 1000);
  const snapshotMinDate = nowSec - 2 * 24 * 60 * 60; // last ~2 days
  const historyMinDate = nowSec - 95 * 24 * 60 * 60; // ~3 months + buffer

  const DATA_QUERY = gql`
    query ($poolIds: [String!]!, $first: Int!, $snapshotMinDate: Int!, $historyMinDate: Int! ){
  pools(
    where: {id_in: $poolIds}
  ) {
    id
    totalValueLockedUSD
    feesUSD
  }
  poolSnapshots: poolHourDatas(
    where: {pool_in: $poolIds, periodStartUnix_gte: $snapshotMinDate }
    first: $first
    orderBy: periodStartUnix
    orderDirection: desc
  ) {
     pool {id}
    periodStartUnix
    volumeUSD
    feesUSD
    
  }
  threeMonthLiquidityData: poolDayDatas(
    where: {pool_in: $poolIds, date_gte: $historyMinDate }
    first: $first
    orderBy: date
    orderDirection: desc
  ) {
     pool {id}
    timestamp: date
    tvlUSD
    feesUSD
    volumeUSD
}
}
`;

  try {
    const result = await client.query(DATA_QUERY, { poolIds, first: 1000, snapshotMinDate, historyMinDate }).toPromise();
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