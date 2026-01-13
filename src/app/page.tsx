import React from 'react';
import LoadingAnimation from "@/components/common/LoadingAnimationCircle";
import HomePage from "./HomePage";
import { Metadata } from "next";
import homePageData from "@/data/homePageData.json"

export const metadata: Metadata = {
  title: "TELx Network – DeFi Liquidity Mining Platform",
  description:
    "TELx Network is a decentralized liquidity mining platform supporting DeFi protocols like Uniswap and Balancer on Polygon and Base. Stake and earn rewards now.",
  keywords:
    "TELx, DeFi, Liquidity Mining, Staking, Uniswap, Base, Polygon, Balancer, USDC, TEL, Yield Farming",
  openGraph: {
    title: "TELx Network",
    description:
      "Decentralized DeFi liquidity mining platform supporting Uniswap and Balancer on Polygon and Base.",
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
      "Stake, earn, and participate in DeFi liquidity mining on Polygon and Base with TELx.",
    images: [`/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`],
    creator: "@telcoin_team",
  },
  metadataBase: new URL("https://telx.network"),
};

export default async function Home() {

  return (
    <>
      {!homePageData ? (
        <LoadingAnimation
          theme="extra-light"
          message="Loading on-chain data..."
        />
      ) : (
        <HomePage
          heroAttributes={homePageData.hero}
          aboutProductsAttributes={homePageData.about_products}
          howItWorksAttributes={homePageData.how_it_works}
          overviewAttributes={homePageData.overview}
          phasesAttributes={homePageData.phases}
          affiliates={homePageData.affiliates}
        />
      )}
    </>
  );
}
