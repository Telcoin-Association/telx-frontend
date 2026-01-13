import { configureStore } from "@reduxjs/toolkit";
import { marketRateApi } from "@/redux/slices/marketRateSlice";
import marketRateReducer from "@/redux/slices/marketRateSlice";
import contractsReducer from "@/redux/slices/contractsSlice";
import web3Reducer from "@/redux/slices/web3Slice";

export const store = configureStore({
  reducer: {
    contracts: contractsReducer,
    marketRate: marketRateReducer,
    web3: web3Reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      marketRateApi.middleware,
    ),
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
