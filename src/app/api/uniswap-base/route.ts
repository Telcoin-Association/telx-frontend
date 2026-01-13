// app/api/uniswap-base/route.ts

import { NextRequest } from "next/server";
import { createClient, gql, Client, cacheExchange, fetchExchange } from "@urql/core";

const client: Client = createClient({
  url: 'https://gateway.thegraph.com/api/subgraphs/id/Gqm2b5J85n1bhCyDMpGbtbVn4935EvvdyHdHrx3dibyj',
  fetchOptions: {
    headers: {
      Authorization: `Bearer ${process.env.UNISWAP_API_KEY}`,
    },
  },
  exchanges: [cacheExchange, fetchExchange],
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const poolAddress = searchParams.get("poolAddress") || "";
  const now = Date.now(); // milliseconds
  const twentyFourHoursAgo = Math.floor((now - 24 * 60 * 60 * 1000) / 1000).toString(); // convert to seconds

  const DATA_QUERY = gql`
   {
      pool (id: "${poolAddress}") {
        id
        totalValueLockedUSD
        feesUSD
      }

      poolSnapshots: poolHourDatas(
        where: { pool: "${poolAddress}", periodStartUnix_gt: ${twentyFourHoursAgo} }
        first: 48
        orderBy: periodStartUnix
        orderDirection: desc
  ) {
        periodStartUnix
        volumeUSD         
        feesUSD      
  }
      quarterYearVolumeData: poolHourDatas(
        where: { pool: "${poolAddress}" }
        first: 91
        orderBy: periodStartUnix
        orderDirection: desc
  ) {
        periodStartUnix
        volumeUSD           
        feesUSD     
        tvlUSD 
  }

      quarterYearLiquidityData: poolDayDatas(
        where: { pool: "${poolAddress}" }
        first: 91
        orderBy: date
        orderDirection: desc
  ) {
        timestamp: date
        tvlUSD
        volumeUSD
  }
   
    }
`;

  try {
    const result = await client.query(DATA_QUERY, {}).toPromise();

    if (result.error) {
      return new Response(JSON.stringify({ error: result.error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result.data), {
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





