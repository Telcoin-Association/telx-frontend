import { ApolloClient, HttpLink, InMemoryCache, gql } from "@apollo/client";

const httpLink = new HttpLink({
  uri: "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-polygon-v2", // your GraphQL endpoint
  headers: {
    "Content-Type": "application/json",
  },
});

// graphql
const client = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache(),
});

export interface BalancerSubgraphInfo {
  pool: {
    id: string;
    address: string;
    totalLiquidity: number;
  };
  poolSnapshots: {
    swapFees: number;
    swapVolume: number;
  }[];
  quarterYearLiquidityData: Array<{
    date: number;
    totalLiquidity: number;
  }>;
  quarterYearVolumeData: Array<{
    date: number;
    swapVolume: number;
    swapFees: number;
  }>;
}

export async function balancerGetSubgraphData(poolAddress: string) {
  const oneDayInMS = 24 * 60 * 60 * 1000;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  let startOfTwoDaysAgo = startOfToday - oneDayInMS - oneDayInMS;
  startOfTwoDaysAgo = Math.floor(startOfTwoDaysAgo / 1000);

  let startOfNinetyDaysAgo = startOfToday - 90 * oneDayInMS;
  startOfNinetyDaysAgo = Math.floor(startOfNinetyDaysAgo / 1000);

  return client.query({
    query: gql`
    {
      pool (id: "${poolAddress}") {
        id
        address
        totalLiquidity
      }
      poolSnapshots (
        where: {timestamp_gte: ${startOfTwoDaysAgo}, pool: "${poolAddress}"}
      ) {
        timestamp
        pool {
          id
        }
        swapFees
        swapVolume
      }
      quarterYearLiquidityData:poolSnapshots (
        where: {timestamp_gte: ${startOfNinetyDaysAgo}, pool: "${poolAddress}"}
      ) {
        timestamp
        liquidity
      }
      quarterYearVolumeData:poolSnapshots (
        where: {timestamp_gte: ${startOfNinetyDaysAgo}, pool: "${poolAddress}"}
      ) {
        timestamp
        swapVolume
        swapFees
      }
    }
    `,
  });
}
