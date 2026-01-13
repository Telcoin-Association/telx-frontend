import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "../store";

export interface MetamaskProvider {
  isMetaMask?: boolean;
  on: any; // function
  request: any; // function
  selectedAddress: string;
}

export type ActiveAction = "approve" | "stake" | "unstake" | "claim" | "exit" | null;

export interface Web3State {
  activeAction: ActiveAction | null;
  hasCheckedForProvider: boolean;
  hasCheckedForWallet: boolean;
  isConfirming: boolean;
  isTransacting: boolean;
  selectedAddress: string | null;
}

const initialState: Web3State = {
  activeAction: null,
  hasCheckedForProvider: false,
  hasCheckedForWallet: false,
  isConfirming: false,
  isTransacting: false,
  selectedAddress: null,
};

export const web3Slice = createSlice({
  name: "web3",
  initialState,
  reducers: {
    setActiveAction: (state: Web3State, action: PayloadAction<ActiveAction>) => {
      state.activeAction = action.payload;
    },
    setHasCheckedForProvider: (state: Web3State) => {
      state.hasCheckedForProvider = true;
    },
    setHasCheckedForWallet: (state: Web3State) => {
      state.hasCheckedForWallet = true;
    },
    setIsConfirming: (state: Web3State, action: PayloadAction<boolean>) => {
      state.isConfirming = action.payload;
    },
    setIsTransacting: (state: Web3State, action: PayloadAction<boolean>) => {
      state.isTransacting = action.payload;
    },
    setSelectedAddress: (state: Web3State, action: PayloadAction<string>) => {
      state.hasCheckedForWallet = true;
      state.selectedAddress = action.payload;
    },
  },
});

// Action creators are generated for each case reducer function
export const { setActiveAction, setHasCheckedForProvider, setHasCheckedForWallet, setIsConfirming, setIsTransacting, setSelectedAddress } =
  web3Slice.actions;

export const web3Selector = (state: RootState) => state.web3;
export const hasCheckedForProviderSelector = (state: RootState) => state.web3.hasCheckedForProvider;
export const hasCheckedForWalletSelector = (state: RootState) => state.web3.hasCheckedForWallet;

export default web3Slice.reducer;
