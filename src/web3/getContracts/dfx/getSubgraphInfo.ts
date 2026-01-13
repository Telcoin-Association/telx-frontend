import { ApolloClient, HttpLink, InMemoryCache, gql } from "@apollo/client";
import { getTimestampForStartOfDay } from "../../../helpers/getTimestamp";

const httpLink = new HttpLink({
  uri: "/api/dfx", // your GraphQL endpoint
  headers: {
    "Content-Type": "application/json",
  },
});

// Use this link to test values on the DFX subgraph
// https://thegraph.com/hosted-service/subgraph/dfx-finance/dfx-v1-polygon
// the uri below is for calling the API
const client = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache(),
 
});

export interface DfxSubgraphInfo {
  pair: {
    reserveUSD: number;
  };
  pairDayData: {
    volumeUSD: number;
  };
  quarterYearLiquidityData: Array<{
    date: number;
    reserveUSD: number;
  }>;
  quarterYearVolumeData: Array<{
    date: number;
    volumeUSD: number;
  }>;
}

export async function dfxGetSubgraphInfo(poolAddress: string) {
  // pairDayData requires concatenated ID
  // ID is the pair contract address and day id (day start timestamp in unix / 86400) concatenated with a dash
  const getPairIdTimestamp = () => {
    const timestamp = getTimestampForStartOfDay();
    return Math.trunc(timestamp / 86400);
  };
  const pairIdTimestamp = getPairIdTimestamp();
  const lowerCasePoolAddress = poolAddress.toLowerCase();

  return client.query({
    query: gql`
      {
        pair(id: "${lowerCasePoolAddress}") {
          reserveUSD
        }
        pairDayData(id: "${lowerCasePoolAddress}-${pairIdTimestamp}") {
          volumeUSD
        }
        quarterYearLiquidityData: pairDayDatas(first: 90, orderBy: date, orderDirection: desc, where: { pair: "${lowerCasePoolAddress}" }) {
          date
          reserveUSD
        }
        quarterYearVolumeData: pairDayDatas(first: 90, orderBy: date, orderDirection: desc, where: { pair: "${lowerCasePoolAddress}" }) {
          date
          volumeUSD
        }
      }
    `,
  });
}
