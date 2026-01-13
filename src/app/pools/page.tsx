import React from "react";
import defaultRewards from "@/data/defaultRewards.json"
import StatsCards from "@/components/home/Stats";
import PoolTabs from "@/components/pools/PoolTabs";
import { Metadata } from "next";
import miningContracts from "@/data/pool.json"

export const metadata: Metadata = {
  title: "Mining Pools DeFi Liquidity Mining Platform",
  description:
    "Discover and explore our active mining pools with reward info and insights.",
  keywords:
    "TELx, DeFi, Liquidity Mining, Staking, Uniswap, Base, Polygon, Balancer, USDC, TEL, Yield Farming",
  openGraph: {
    title: "Mining Pools DeFi Liquidity Mining Platform",
    description:
      "Discover and explore our active mining pools with reward info and insights.",
    url: "https://telx.network",
    siteName: "TELx Network",
    images: [
      {
        url: `/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`,
        width: 1200,
        height: 630,
        alt: "TELx Network",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TELx Network",
    description:
      "Discover and explore our active mining pools with reward info and insights.",
    images: [`/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`],
    creator: "@telcoin_team",
  },
  metadataBase: new URL("https://telx.network"),
};

export default async function Page() {

  return (
    <div className="mx-auto min-h-screen max-w-7xl py-20">
      <div className="mb-10 ml-auto w-full max-w-3xl p-4">
        <StatsCards />
      </div>
      <PoolTabs miningContracts={miningContracts} />
    </div>
  );
}
