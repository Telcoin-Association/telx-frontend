import React from "react";
import PoolDetails from "./PoolDetails";
import pools from "@/data/pool.json";
import defaultRewards from "@/data/defaultRewards.json"
import notices from "@/data/notices.json"
import { Suspense } from "react";
import PoolDetailsSkeleton from "@/components/pool/PoolDetailsSkeleton";
import { poolDisplayName, poolPageTitle } from "@/lib/poolTitle";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ poolID: string }>;
}) {
  const { poolID } = await params;
  // pool.json's `name` is an internal label; the page is named from its tokens and chain.
  const poolName = poolDisplayName(pools, poolID);
  const title = poolPageTitle(poolName);

  return {
    title,
    description: poolName
      ? `Explore detailed information about the ${poolName} pool including rewards and more.`
      : "Explore details of our mining pools.",
    openGraph: {
      title,
      description: poolName
        ? `Get the latest rewards, notices, and stats for the ${poolName} pool.`
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
  params: Promise<{ poolID: string }>;
}) {
  const { poolID } = await params;

  return (
      <Suspense
        fallback={
          <main className="md:px-4 min-h-screen sm:pb-12 pt-8 max-w-7xl mx-auto">
            <PoolDetailsSkeleton />
          </main>
        }
      >
        <PoolDetails
          poolID={poolID}
          defaultRewards={defaultRewards}
          notices={notices}
        />
      </Suspense>
  );
}

// Prerenders one page per registry pool id. Ids shared by several chains (Uniswap v4 pools) are listed once;
// the chain comes from the `chain` search param at runtime. Ids outside the registry still render on demand.
export async function generateStaticParams(): Promise<{ poolID: string }[]> {
  const ids = pools.map((pool) => pool.attributes.pool_address).filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids), (poolID) => ({ poolID }));
}
