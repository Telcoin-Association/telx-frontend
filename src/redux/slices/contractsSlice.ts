import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import BigNumber from "bignumber.js";
import {
  miningContract,
  normalizeMiningContracts,
  miningContractFields,
} from "@/helpers/normalizeMiningContracts";
import {
  ProtocolsContractData,
  getAllContractData,
} from "@/web3/getContracts/shared";
import { RootState } from "@/redux/store";
import { getPoolMapKey } from "@/lib/contracts";
import { DataFreshness } from "@/types/PoolMetrics";

export const fetchAllContractData = createAsyncThunk(
  "contracts/fetchAllContractData",
  async (selectedAddress: string | undefined, thunkApi) => {
    const {
      contracts: { list },
    } = thunkApi.getState() as RootState;
    const response = await getAllContractData(list, selectedAddress);

    return response;
  }
);

export type ContractList = { [key: string]: ProtocolsContractData };

interface ContractsState {
  contracts: ContractList;
  hasFetchedData: boolean;
  list: miningContract[];
  loading: boolean;
  deprecatedContracts: ContractList;
  deprecatedPools: ContractList;
  totalLiquidityAll: number | null;
  stakedLiquidityAll: number | null;
  totalVolumeAll: number | null;
  totalFeesAll: number | null;
  userContracts: ContractList;
  userUniswapContracts: ContractList;
  value: number;
  dataFreshness: DataFreshness | null;
  lastError: string | null;
  failedAttempts: number;
}

const initialState = {
  contracts: {},
  hasFetchedData: false,
  list: [],
  loading: true,
  deprecatedContracts: {},
  deprecatedPools: {},
  totalLiquidityAll: null,
  stakedLiquidityAll: null,
  totalVolumeAll: null,
  totalFeesAll: null,
  userContracts: {},
  userUniswapContracts: {},
  value: 0,
  dataFreshness: null,
  lastError: null,
  failedAttempts: 0,
} as ContractsState;

export const contractsSlice = createSlice({
  name: "contracts",
  initialState,
  reducers: {
    initializeList: (
      state: any,
      action: PayloadAction<miningContractFields[]>
    ) => {
      const returnedMiningContracts = normalizeMiningContracts(
        action.payload
      );
      state.list = returnedMiningContracts;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchAllContractData.pending, (state) => {
      state.loading = true;
    });
    builder.addCase(fetchAllContractData.rejected, (state, action) => {
      // Leave hasFetchedData unchanged: a failed load is not data, and flipping it would re-trigger
      // AppLayout's first-load fetch with no delay. AppLayout retries with backoff instead.
      state.loading = false;
      state.lastError = action.error.message ?? "unknown";
      state.failedAttempts += 1;
    });
    builder.addCase(fetchAllContractData.fulfilled, (state, action) => {
      const contracts: any = {};
      const deprecatedPools: any = {};
      const deprecatedContracts: any = {};
      const userContracts: any = {};
      const uniswapUserContracts: any = [];
      let totalLiquidityAll = new BigNumber(0);
      let stakedLiquidityAll = new BigNumber(0);
      let totalVolumeAll = new BigNumber(0);
      let totalFeesAll = new BigNumber(0);
      action.payload.contracts.forEach((contract: any) => {
        if (contract?.poolContractAddress) {
          const contractKey = getPoolMapKey(
            contract.poolContractAddress,
            contract.blockchain,
            contract.protocol
          );
          if (contract.active) {
            contracts[contractKey] = contract;
            // Create BigNumbers from string representations
            const totalLiquidity = contract.totalLiquidity
              ? new BigNumber(String(contract.totalLiquidity))
              : new BigNumber(0);
            const stakedLiquidity = contract.stakedLiquidity
              ? new BigNumber(String(contract.stakedLiquidity))
              : new BigNumber(0);
            const totalVolume = contract.dailyVolumeUSD
              ? new BigNumber(String(contract.dailyVolumeUSD))
              : new BigNumber(0);
            const totalFees = contract.fees24hr
              ? new BigNumber(String(contract.fees24hr))
              : new BigNumber(0);

            // Handle user.stakedLPT conversion
            if (contract?.user?.stakedLPT) {
              const stakedLPT: any = contract.user.stakedLPT;
              const stakedLPTString =
                typeof stakedLPT === "bigint"
                  ? stakedLPT.toString()
                  : String(stakedLPT);

              if (new BigNumber(stakedLPTString).isGreaterThan(0)) {
                userContracts[contractKey] = contract;
              }
            }


            totalLiquidityAll = totalLiquidityAll.plus(totalLiquidity);
            stakedLiquidityAll = stakedLiquidityAll.plus(stakedLiquidity);
            totalVolumeAll = totalVolumeAll.plus(totalVolume);
            totalFeesAll = totalFeesAll.plus(totalFees);

            if (
              contract.deprecatedStakingAddresses &&
              contract.deprecatedStakingAddresses.length > 0 || contract.protocol === "uniswap"
            ) {
              deprecatedContracts[contractKey] = contract;
            }



          } else {
            deprecatedPools[contractKey] = contract;
          }
          if (contract.protocol === "uniswap") {
            uniswapUserContracts.push(contract);
          }
        }
      });

      state.hasFetchedData = true;
      state.dataFreshness = action.payload.meta;
      state.lastError = null;
      state.failedAttempts = 0;
      state.contracts = contracts;
      state.deprecatedContracts = deprecatedContracts;
      state.deprecatedPools = deprecatedPools;
      state.totalLiquidityAll = totalLiquidityAll.toNumber();
      state.stakedLiquidityAll = stakedLiquidityAll.toNumber();
      state.totalVolumeAll = totalVolumeAll.toNumber();
      state.totalFeesAll = totalFeesAll.toNumber();
      state.userContracts = userContracts;
      state.userUniswapContracts = uniswapUserContracts;
      state.loading = false;
    });
  },
});

export const { initializeList } = contractsSlice.actions;

export const contractsSelector = (state: RootState) =>
  state.contracts.contracts;
export const contractsLoadingSelector = (state: RootState) =>
  state.contracts.loading;
export const contractsListSelector = (state: RootState) => state.contracts.list;
export const deprecatedContractsListSelector = (state: RootState) =>
  state.contracts.deprecatedContracts;
export const deprecatedPoolsListSelector = (state: RootState) =>
  state.contracts.deprecatedPools;
export const totalLiquiditySelector = (state: RootState) =>
  state.contracts.totalLiquidityAll;
export const stakedLiquiditySelector = (state: RootState) =>
  state.contracts.stakedLiquidityAll;
export const totalVolumeSelector = (state: RootState) =>
  state.contracts.totalVolumeAll;
export const totalFeesSelector = (state: RootState) =>
  state.contracts.totalFeesAll;
export const hasFetchedDataSelector = (state: RootState) =>
  state.contracts.hasFetchedData;
export const userContractsSelector = (state: RootState) =>
  state.contracts.userContracts;
export const userUniswapContractsSelector = (state: RootState) =>
  state.contracts.userUniswapContracts;
export const dataFreshnessSelector = (state: RootState) =>
  state.contracts.dataFreshness;
export const contractsErrorSelector = (state: RootState) =>
  state.contracts.lastError;
export const failedAttemptsSelector = (state: RootState) =>
  state.contracts.failedAttempts;

export default contractsSlice.reducer;
