import { ApolloClient, HttpLink, InMemoryCache, gql } from "@apollo/client";

const httpLink = new HttpLink({
  uri: "/api/quickswap", // your GraphQL endpoint
  headers: {
    "Content-Type": "application/json",
  },
});

// the uri below is for calling the API
const client = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache(),
 
});

export interface QuickswapSubgraphInfo {
  pair: {
    reserveUSD: number;
  };
  pairDayDatas: Array<{
    date: number;
    dailyVolumeUSD: number;
  }>;
  quarterYearLiquidityData: Array<{
    date: number;
    reserveUSD: number;
  }>;
  quarterYearVolumeData: Array<{
    date: number;
    dailyVolumeUSD: number;
  }>;
}

export async function quickswapGetSubgraphInfo(poolAddress: string) {
  return client.query({
    query: gql`
    {
      pair(id: "${poolAddress}") {
        reserveUSD
      }
      pairDayDatas(first: 1, orderBy: date, orderDirection: desc, where: {pairAddress: "${poolAddress}"}) {
        date
        dailyVolumeUSD
      }
      quarterYearLiquidityData: pairDayDatas(first: 90, orderBy: date, orderDirection: desc, where: {pairAddress: "${poolAddress}"}) {
        date
        reserveUSD
      }
      quarterYearVolumeData: pairDayDatas(first: 90, orderBy: date, orderDirection: desc, where: {pairAddress: "${poolAddress}"}) {
        date
        dailyVolumeUSD
      }
    }
    `,
  });
}
