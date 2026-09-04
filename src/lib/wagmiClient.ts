"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, mainnet, polygon } from "wagmi/chains";
import { http} from "wagmi";
import {
  metaMaskWallet,
  coinbaseWallet,
  injectedWallet,
  ledgerWallet,
  safeWallet,
  walletConnectWallet
} from "@rainbow-me/rainbowkit/wallets";

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
  chains: [mainnet, polygon, base], // *
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
    [mainnet.id]: http(), // **
    [polygon.id]: http(), // **
    [base.id]: http(), // **
  },
});