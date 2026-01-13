import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

export type MarketRateData = {
  [ticker: string]: {
    USD: number;
  };
};

/*
 *`createApi` is bundled in the Redux Toolkit Query (RTK Query) library and gives us
 * a simple means of creating redux slices that fetch (GET, POST, etc) from remote
 * resources and generate a consistent `state` interface. Use the exported hook like so:
 * `const { data, isLoading, isError } = useGetMarketRateQuery();`
 * and you have fast access to loading and error state plus the fetched and cached `data`.
 */
export const marketRateApi = createApi({
  reducerPath: "marketRate",
  baseQuery: fetchBaseQuery({
    baseUrl: "/api",
  }),
  endpoints: builder => ({
    getMarketRate: builder.query<MarketRateData, void>({
      query: () => "/market-rate",
    }),
  }),
});

// Export hooks for usage in functional components. these are auto-generated.
export const { useGetMarketRateQuery } = marketRateApi;

export default marketRateApi.reducer;
