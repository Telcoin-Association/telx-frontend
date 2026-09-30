"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, mainnet, polygon } from "wagmi/chains";
import { http } from "wagmi";
import {
  metaMaskWallet,
  baseAccount,
  injectedWallet,
  ledgerWallet,
  safeWallet,
  walletConnectWallet
} from "@rainbow-me/rainbowkit/wallets";
import { rpcProxyUrl } from "./rpc";

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
        baseAccount,
        walletConnectWallet,
        injectedWallet,
        ledgerWallet,
        safeWallet,
      ],
    },
  ],
  ssr: true,
  // One call per request through the RPC proxy, so no request exceeds its RPC_MAX_BATCH.
  transports: {
    [mainnet.id]: http(rpcProxyUrl("ethereum"), { batch: false }),
    [polygon.id]: http(rpcProxyUrl("polygon"), { batch: false }),
    [base.id]: http(rpcProxyUrl("base"), { batch: false }),
  },
});