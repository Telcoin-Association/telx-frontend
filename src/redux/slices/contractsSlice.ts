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

const isPositive = (value: unknown): boolean => {
  if (value === null || value === undefined || value === "") return false;
  const amount = new BigNumber(typeof value === "bigint" ? value.toString() : String(value));
  return amount.isFinite() && amount.isGreaterThan(0);
};

/**
 * Whether the connected wallet has LP tokens staked in the pool, in its current staking contract or in
 * one it has retired. Checked for every pool, active or not: a deprecated pool keeps its stakers until
 * they claim and unstake, so it must stay reachable from Portfolio whatever the pool's listing flags say.
 */
export const hasUserStake = (contract: any): boolean =>
  isPositive(contract?.user?.stakedLPT) || isPositive(contract?.user?.deprecated?.stakedLPT);

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
      state.loading = true;
      state.currentRequestId = action.meta.requestId;
    });
    builder.addCase(fetchAllContractData.rejected, (state, action) => {
      if (isSuperseded(state, action.meta.requestId)) return;
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
          if (hasUserStake(contract)) {
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
