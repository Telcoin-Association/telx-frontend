// /api/quickswap-grouped

import { NextRequest } from "next/server";
import { createClient, gql, Client, cacheExchange, fetchExchange } from "@urql/core";
import { groupByPoolId } from "@/helpers/normalizeSubgraphData";

const client: Client = createClient({
  url: 'https://gateway.thegraph.com/api/subgraphs/id/6K19ca6rG5cDS7ZPdfVbEtgUAT3B7wjqTu6wpyXvqNJJ',
  fetchOptions: {
    headers: {
      Authorization: `Bearer ${process.env.UNISWAP_API_KEY}`,
    },
  },
  exchanges: [cacheExchange, fetchExchange],
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // get all poolIds
  const poolIds = searchParams.getAll("poolIds").filter(Boolean) || [];

  const DATA_QUERY = gql`
  query ($poolIds: [String!]!, $number: Int!, $numberBy90: Int!) {
    pools:pairs(where: { id_in: $poolIds }) {
      reserveUSD
      id
    }

    poolSnapshots: pairDayDatas(
      first: $number
      orderBy: date
      orderDirection: desc
      where: { pairAddress_in: $poolIds }
    ) {
      date
      dailyVolumeUSD
      poolAddress: pairAddress
    }

    quarterYearLiquidityData: pairDayDatas(
      first: $numberBy90
      orderBy: date
      orderDirection: desc
      where: { pairAddress_in: $poolIds }
    ) {
      date
      reserveUSD
      poolAddress: pairAddress
      dailyVolumeUSD
    }

  }
`;

  try {
    const result = await client.query(DATA_QUERY, { poolIds, number: poolIds.length, numberBy90: 90 * poolIds.length }).toPromise();

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