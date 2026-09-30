import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import BigNumber from "bignumber.js";
import { hasUserHoldings } from "@/lib/userHoldings";
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

/**
 * What to load pool data for: the connected wallet's address (or none), or a background refresh of the data
 * already on screen. A background load shows no spinner, and when it fails it leaves the current data and
 * no error, since the next refresh tries again.
 */
export type ContractDataLoad = string | undefined | { address: string | undefined; background: true };

const loadAddress = (load: ContractDataLoad) => (typeof load === "object" ? load.address : load);
const isBackgroundLoad = (load: ContractDataLoad) => typeof load === "object" && load.background;

export const fetchAllContractData = createAsyncThunk(
  "contracts/fetchAllContractData",
  async (load: ContractDataLoad, thunkApi) => {
    const {
      contracts: { list },
    } = thunkApi.getState() as RootState;
    const response = await getAllContractData(list, loadAddress(load), { background: isBackgroundLoad(load) });

    return response;
  }
);

export type ContractList = { [key: string]: ProtocolsContractData };

// Delay before each retry of a failed load; no retry after the last one.
export const LOAD_RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

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
  /** When the data on screen was loaded (unix ms), or null before the first load. */
  loadedAt: number | null;
  /** requestId of the latest fetchAllContractData; results of older requests are ignored. */
  currentRequestId?: string;
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
  loadedAt: null,
} as ContractsState;

/** A sum that stays null until a finite number has been added. */
class Total {
  private sum = new BigNumber(0);
  private seen = false;
  add(value: unknown) {
    if (value == null || value === "") return;
    const n = new BigNumber(String(value));
    if (!n.isFinite()) return;
    this.sum = this.sum.plus(n);
    this.seen = true;
  }
  value(): number | null {
    return this.seen ? this.sum.toNumber() : null;
  }
}

/**
 * A pool's contribution to the Staked total: the liquidity earning rewards right now. For Uniswap v4
 * that is Merkl's subscribed TVL while a campaign is LIVE; a scheduled, ended or unknown campaign adds
 * nothing. Pools with a staking contract contribute the staked value read from it. Null means no known
 * value, so a load without rewards data leaves the total null ("Unavailable") rather than $0.
 */
export function stakedLiquidityOf(contract: any): number | null {
  if (contract?.protocol === "uniswap") {
    return contract.rewardsStatus === "LIVE" ? (contract.subscribedTvlUSD ?? null) : null;
  }
  return contract?.stakedLiquidity ?? null;
}

export { hasUnclaimedRewards, hasUserHoldings, hasUserStake } from "@/lib/userHoldings";

const isSuperseded = (state: { currentRequestId?: string }, requestId: string) =>
  state.currentRequestId !== undefined && state.currentRequestId !== requestId;

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
    // A new account gets a fresh retry budget.
    clearLoadError: (state) => {
      state.lastError = null;
      state.failedAttempts = 0;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchAllContractData.pending, (state, action) => {
      if (!isBackgroundLoad(action.meta.arg)) state.loading = true;
      state.currentRequestId = action.meta.requestId;
    });
    builder.addCase(fetchAllContractData.rejected, (state, action) => {
      if (isSuperseded(state, action.meta.requestId)) return;
      if (isBackgroundLoad(action.meta.arg)) return;
      // Leave hasFetchedData unchanged: a failed load is not data, and flipping it would re-trigger
      // AppLayout's first-load fetch with no delay. AppLayout retries with backoff instead.
      state.loading = false;
      state.lastError = action.error.message ?? "unknown";
      state.failedAttempts += 1;
    });
    builder.addCase(fetchAllContractData.fulfilled, (state, action) => {
      if (isSuperseded(state, action.meta.requestId)) return;
      const contracts: any = {};
      const deprecatedPools: any = {};
      const deprecatedContracts: any = {};
      const userContracts: any = {};
      const uniswapUserContracts: any = [];
      // Each total is null until an active pool contributes a number, so an all-unknown load
      // reads as "Unavailable" rather than $0.
      const totalLiquidityAll = new Total();
      const stakedLiquidityAll = new Total();
      const totalVolumeAll = new Total();
      const totalFeesAll = new Total();
      action.payload.contracts.forEach((contract: any) => {
        if (contract?.poolContractAddress) {
          const contractKey = getPoolMapKey(
            contract.poolContractAddress,
            contract.blockchain,
            contract.protocol
          );
          if (hasUserHoldings(contract)) {
            userContracts[contractKey] = contract;
          }
          if (contract.active) {
            contracts[contractKey] = contract;

            totalLiquidityAll.add(contract.totalLiquidity);
            stakedLiquidityAll.add(stakedLiquidityOf(contract));
            totalVolumeAll.add(contract.dailyVolumeUSD);
            totalFeesAll.add(contract.fees24hr);

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
      state.loadedAt = Date.now();
      state.contracts = contracts;
      state.deprecatedContracts = deprecatedContracts;
      state.deprecatedPools = deprecatedPools;
      state.totalLiquidityAll = totalLiquidityAll.value();
      state.stakedLiquidityAll = stakedLiquidityAll.value();
      state.totalVolumeAll = totalVolumeAll.value();
      state.totalFeesAll = totalFeesAll.value();
      state.userContracts = userContracts;
      state.userUniswapContracts = uniswapUserContracts;
      state.loading = false;
    });
  },
});

export const { initializeList, clearLoadError } = contractsSlice.actions;

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
export const loadedAtSelector = (state: RootState) => state.contracts.loadedAt;
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
