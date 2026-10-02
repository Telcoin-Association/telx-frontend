"use client";

import {
  contractsLoadingSelector,
  contractsSelector,
  deprecatedPoolsListSelector,
  hasFetchedDataSelector,
} from "@/redux/slices/contractsSlice";
import { Notice as NoticeProps } from "@/types/Notice";
import { getChartData } from "@/components/chart/chart";
import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "@/redux/hooks";
import { useSearchParams } from "next/navigation";
import ContractActions from "@/components/contract/ContractActions";
import PoolDetailsSkeleton from "@/components/pool/PoolDetailsSkeleton";
import ContractInfo from "@/components/contract/ContractInfo";
import PoolHeading from "@/components/common/PoolHeading";
import ChartTabs from "@/components/chart/ChartTabs";
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Asset } from "@/components/pool/PoolSnapshotAssets";
import { base, mainnet, polygon } from "viem/chains";
import { useCheckChain } from "@/hooks/useCheckChain";
import { getPoolPath, isMerklUniswapPool } from "@/lib/contracts";
import { orderPoolAssets } from "@/lib/positionView";
import AddLiquidityPanel from "@/components/common/AddLiquidityPanel";
import { ARCHIVED_POOL_HELP, ARCHIVED_POOL_NOTE, isArchivedPool } from "@/lib/archivedPool";
import { findLoadedPool } from "@/lib/poolLookup";
import { chainDisplayName } from "@/lib/poolTitle";
import PoolDataAge from "@/components/pool/PoolDataAge";
import BridgeTelNote from "@/components/pool/BridgeTelNote";
import { usePoolSvl } from "@/hooks/usePoolSvl";
import { getSubscribedValue } from "@/helpers/poolRewardsDisplay";
import { useNow } from "@/hooks/useNow";

/** The message and links shown in place of a pool page when the URL does not name one loaded pool. */
function PoolNotShown({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-4 flex flex-col items-center gap-3 rounded-2xl bg-black/20 px-6 py-12 text-center text-white md:mx-0">
      {children}
      <Link href="/pools" className="text-sm font-bold text-white underline underline-offset-4">
        Browse all pools
      </Link>
    </div>
  );
}

interface PagePoolProps {
  /** The `[poolID]` route segment: the pool address, or the pool ID for Uniswap v4. */
  poolID: string;
  defaultRewards: any;
  notices: NoticeProps[];
}

/** The pool's two assets in currency order, as the Add liquidity tab names and draws them. */
function addLiquidityAssets(assets: { ticker?: string; address?: string | null }[] | undefined): [{ ticker?: string; address?: string | null }, { ticker?: string; address?: string | null }] {
  const [first, second] = orderPoolAssets(assets);
  return [first ?? {}, second ?? {}];
}

export default function PoolDetails({
  poolID,
  defaultRewards,
  notices,
}: PagePoolProps) {
  const searchParams = useSearchParams();
  const rewardAttributes = defaultRewards[0]?.attributes;
  const addressFromUrl = poolID;
  const chainFromUrl = searchParams.get("chain") ?? undefined;
  const [currentPoolAddress, setCurrentPoolAddress] = useState(addressFromUrl);
  const [contractData, setContractData] = useState<any>();
  const contracts = useAppSelector(contractsSelector);
  const deprecatedList = useAppSelector(deprecatedPoolsListSelector);
  const hasFetchedData = useAppSelector(hasFetchedDataSelector);
  const loading = useAppSelector(contractsLoadingSelector);
  const _assets = contractData?.assets;
  const targetChain =
    contractData?.blockchain === "ethereum"
      ? mainnet
      : contractData?.blockchain === "base"
        ? base
        : polygon;

  // Every loaded pool, active or archived. The page matches the URL's id without regard to case, on the
  // `chain` search param when there is one, or on the only chain the id is loaded on.
  const loadedPools = useMemo(
    () => [...Object.values(contracts ?? {}), ...Object.values(deprecatedList ?? {})] as any[],
    [contracts, deprecatedList]
  );
  const lookup = useMemo(() => findLoadedPool(currentPoolAddress, chainFromUrl, loadedPools), [currentPoolAddress, chainFromUrl, loadedPools]);

  const chartData: any = contractData ? getChartData(contractData) : {};

  useEffect(() => {
    if (addressFromUrl !== currentPoolAddress) {
      setContractData(undefined);
      setCurrentPoolAddress(addressFromUrl);
    }
  }, [addressFromUrl, currentPoolAddress]);

  useEffect(() => {
    if (lookup.kind === "found") setContractData(lookup.pool);
  }, [lookup]);

  const {
    liquidityWeights,
    liquidityLabels,
    volumeWeights,
    volumeLabels,
    feeWeights,
    feeLabels,
  } = chartData;

  // Subscribed liquidity for the chart card, on Merkl pools only.
  const merklPool = contractData?.protocol === "uniswap" && isMerklUniswapPool(currentPoolAddress);
  const svlDays = usePoolSvl(contractData?.blockchain, currentPoolAddress, merklPool);
  const subscribed = getSubscribedValue(contractData, useNow());
  const svl = merklPool
    ? { days: svlDays, current: subscribed.kind === "value" ? subscribed.usd : null, share: subscribed.kind === "value" ? subscribed.share : null }
    : undefined;

  // Chain switch for pool page
  useCheckChain(targetChain); // ✅ always called in same position

  return (
    <main className="md:px-4 min-h-screen sm:pb-12 pt-8 max-w-7xl mx-auto">
      {contractData ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 w-fit px-4 xl:px-0">
            <Link href={'/pools'} className=" text-primary text-sm hover:text-white">Pools</Link>
            <Image src={'/icons/breadCrumb.svg'} alt={''} width={6} height={6} style={{ height: "auto", width: "auto" }} />
            <div className='text-white text-sm flex gap-2'>
              {_assets.map((asset: Asset, i: string) => {
                const { ticker, weight } = asset;
                return <div key={i}>
                  <span className=" text-white">{ticker} </span>
                  <span>{!isNaN(weight) && `${weight}%`} </span></div>;
              })}</div>
          </div>
          <PoolHeading contractData={contractData} />
          <PoolDataAge pool={contractData} />
          <BridgeTelNote pool={contractData} />
          <div className="md:px-0 md:rounded-xl grid grid-cols-1 md:grid-cols-3 md:gap-4 px-4">
            <div className="order-2 md:order-1 mt-4 md:mt-0">
              <ContractInfo
                selectedPool={contractData}
                defaultRewards={rewardAttributes}
              />
            </div>
            <div className="col-span-2 order-1 md:order-2">
              {isArchivedPool(contractData) ? (
                <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-xl bg-black/20 p-6 text-center">
                  <h3 className="text-white">{ARCHIVED_POOL_NOTE}</h3>
                  <p className="max-w-md text-sm text-primary">{ARCHIVED_POOL_HELP}</p>
                </div>
              ) : (
                <ChartTabs
                  totalLiquidity={contractData.totalLiquidity}
                  dailyVolume={contractData.dailyVolumeUSD}
                  dailyFees={contractData.fees24hr}
                  liquidityWeights={liquidityWeights}
                  liquidityLabels={liquidityLabels}
                  volumeWeights={volumeWeights}
                  volumeLabels={volumeLabels}
                  feeWeights={feeWeights}
                  feeLabels={feeLabels}
                  svl={svl}
                  addLiquidity={
                    contractData.protocol === "uniswap" && isMerklUniswapPool(currentPoolAddress) ? (
                      <AddLiquidityPanel
                        blockchain={contractData.blockchain}
                        poolId={currentPoolAddress}
                        assets={addLiquidityAssets(contractData.assets)}
                      />
                    ) : undefined
                  }
                />
              )}
            </div>
          </div>
          <div className="px-4 md:px-0 ">
            <ContractActions
              selectedPool={contractData}
              notices={notices}
              currentPoolAddress={currentPoolAddress}
            />
          </div>
        </div>
      ) : lookup.kind === "choose" ? (
        <PoolNotShown>
          <h1 className="text-lg">This pool is on {lookup.chains.length > 1 ? "several networks" : "another network"}.</h1>
          <p className="text-sm text-primary">Choose the network to open:</p>
          <ul className="flex flex-wrap justify-center gap-3">
            {lookup.chains.map((chain) => (
              <li key={chain}>
                <Link href={getPoolPath(currentPoolAddress, chain, "uniswap")} className="rounded-lg border border-white/20 px-4 py-2 text-sm transition-colors hover:border-white/40 hover:bg-white/10">
                  {chainDisplayName(chain)}
                </Link>
              </li>
            ))}
          </ul>
        </PoolNotShown>
      ) : hasFetchedData && !loading ? (
        <PoolNotShown>
          <h1 className="text-lg">Pool not found</h1>
          <p className="max-w-md text-sm text-primary">No pool with this address is listed on TELx. Check the link, or find the pool in the list.</p>
        </PoolNotShown>
      ) : (
        <PoolDetailsSkeleton />
      )}
    </main>
  );
}
