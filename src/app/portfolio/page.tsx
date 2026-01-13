import React from "react";
import { Metadata } from "next";
import PortfolioPage from "./PortfolioPage";

export const metadata: Metadata = {
  title: "Portfolio - TELx Network",
  description:
    "TELx Network is a decentralized liquidity mining platform supporting DeFi protocols like Uniswap and Balancer on Polygon and Base. Stake and earn rewards now.",
  keywords:
    "TELx, DeFi, Liquidity Mining, Staking, Uniswap, Polygon, Base, Balancer, USDC, TEL, Yield Farming",
  openGraph: {
    title: "TELx - Portfolio",
    description:
      "TELx Network is a decentralized liquidity mining platform supporting DeFi protocols like Uniswap and Balancer on Polygon and Base. Stake and earn rewards now.",
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
    title: "TELx - Portfolio",
    description:
      "Stake, earn, and participate in DeFi liquidity mining on Polygon and Base with TELx.",
    images: [`/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`],
    creator: "@telcoin_team",
  },
  metadataBase: new URL("https://telx.network"),
};

export default async function Page() {
  return (
    <PortfolioPage />
  );
}
