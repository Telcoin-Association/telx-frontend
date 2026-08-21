"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, polygon } from "wagmi/chains";
import { http} from "wagmi";
import {
  metaMaskWallet,
  coinbaseWallet,
  injectedWallet,
  ledgerWallet,
  safeWallet,
  walletConnectWallet
} from "@rainbow-me/rainbowkit/wallets";
import { BASE_RPC_URL, POLYGON_RPC_URL } from "./contracts";

const WALLETCONNECT_PROJECT_ID: any =
  process?.env?.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

  declare module 'wagmi' {
    interface Register {
      config: typeof config
    }
  }

export const config = getDefaultConfig({
  appName: "Telx Network",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [polygon, base], // *
  wallets: [
    {
      groupName: "Supported Wallets",
      wallets: [
        metaMaskWallet,
        coinbaseWallet,
        walletConnectWallet,
        injectedWallet,
        ledgerWallet,
        safeWallet,
      ],
    },
  ],
  ssr: true,
  transports: {
    [polygon.id]: http(POLYGON_RPC_URL), // **
    [base.id]: http(BASE_RPC_URL), // **
  },
});