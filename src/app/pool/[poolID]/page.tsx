import React from "react";
import PoolDetails from "./PoolDetails";
import pools from "@/data/pool.json";
import defaultRewards from "@/data/defaultRewards.json"
import notices from "@/data/notices.json"
import { Suspense } from "react";
import LoadingWrapper from "@/components/common/LoadingWrapper";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ poolID: string }>;
}) {
  const { poolID } = await params;
  const pool = pools.find((p: any) => p.attributes.pool_address === poolID);

  return {
    title: pool ? `Pool ${pool.attributes.name} Details` : "Pool Details",
    description: pool
      ? `Explore detailed information about ${pool.attributes.name} including rewards and more.`
      : "Explore details of our mining pools.",
    openGraph: {
      title: pool ? `${pool.attributes.name} - Mining Pool` : "Mining Pool",
      description: pool
        ? `Get the latest rewards, notices, and stats for ${pool.attributes.name}.`
        : "Mining pool insights and reward information.",
      images: [
        {
          url: `/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`,
          width: 1200,
          height: 630,
          alt: "TELx Network",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "TELx - Rewards",
      description:
        "Stake, earn, and participate in DeFi liquidity mining on Polygon and Base with TELx.",
      images: [`/telx-og-image.png?ver=${process.env.NEXT_PUBLIC_BUILD_ID || Date.now()}`],
      creator: "@telcoin_team",
    },
    metadataBase: new URL("https://telx.network"),
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
      <Suspense fallback={<LoadingWrapper />}>
        <PoolDetails
          slug={slug}
          defaultRewards={defaultRewards}
          notices={notices}
        />
      </Suspense>
  );
}

export async function generateStaticParams() {
  return pools.map((contract: any) => ({
    slug: contract?.attributes?.pool_address,
  }));
}
