"use client";

import {
  contractsSelector,
  deprecatedPoolsListSelector,
} from "@/redux/slices/contractsSlice";
import { Notice as NoticeProps } from "@/types/Notice";
import { getChartData } from "@/components/chart/chart";
import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "@/redux/hooks";
import { usePathname, useSearchParams } from "next/navigation";
import ContractActions from "@/components/contract/ContractActions";
import LoadingWrapper from "@/components/common/LoadingWrapper";
import ContractInfo from "@/components/contract/ContractInfo";
import PoolHeading from "@/components/common/PoolHeading";
import ChartTabs from "@/components/chart/ChartTabs";
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Asset } from "@/components/pool/PoolSnapshotAssets";
import { base, mainnet, polygon } from "viem/chains";
import { useCheckChain } from "@/hooks/useCheckChain";
import { getPoolMapKey } from "@/lib/contracts";

interface PagePoolProps {
  slug: string;
  defaultRewards: any;
  notices: NoticeProps[];
}

export default function PoolDetails({
  defaultRewards,
  notices,
}: PagePoolProps) {
  const path = usePathname();
  const searchParams = useSearchParams();
  const rewardAttributes = defaultRewards[0]?.attributes;
  const addressFromUrl = path?.split("/").pop() ?? "";
  const chainFromUrl = searchParams.get("chain") ?? undefined;
  const [currentPoolAddress, setCurrentPoolAddress] = useState(addressFromUrl);
  const [contractData, setContractData] = useState<any>();
  const contracts = useAppSelector(contractsSelector);
  const deprecatedList = useAppSelector(deprecatedPoolsListSelector);
  const _assets = contractData?.assets;
  const targetChain =
    contractData?.blockchain === "ethereum"
      ? mainnet
      : contractData?.blockchain === "base"
        ? base
        : polygon;

  const contractsList = useMemo(
    () => ({
      ...contracts,
    }),
    [contracts]
  );

  let chartData: any = {};
  if (contractData && contractData.totalLiquidity) {
    chartData = getChartData(contractData);
  }

  useEffect(() => {
    if (addressFromUrl !== currentPoolAddress) {
      setContractData(undefined);
      setCurrentPoolAddress(addressFromUrl);
    }
  }, [addressFromUrl, currentPoolAddress]);

  useEffect(() => {
    const mapKey = getPoolMapKey(currentPoolAddress, chainFromUrl, chainFromUrl ? "uniswap" : undefined);
    if (
      contractsList &&
      Object.values(contractsList).length > 0 &&
      (contractsList[mapKey] || contractsList[currentPoolAddress])
    ) {
      const temp = contractsList[mapKey] || contractsList[currentPoolAddress];
      setContractData(temp);
    } else if (
      deprecatedList &&
      Object.values(deprecatedList).length > 0 &&
      (deprecatedList[mapKey] || deprecatedList[currentPoolAddress])
    ) {
      // pool is deprecated
      setContractData(deprecatedList[mapKey] || deprecatedList[currentPoolAddress]);
    }
  }, [contractsList, currentPoolAddress, chainFromUrl, deprecatedList]);

  const {
    totalLiquidity,
    dailyVolume,
    dailyFees,
    liquidityWeights,
    liquidityLabels,
    volumeWeights,
    volumeLabels,
    feeWeights,
    feeLabels,
  } = chartData;

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
          <div className="md:px-0 md:rounded-xl grid grid-cols-1 md:grid-cols-3 md:gap-4 px-4">
            <div className="order-2 md:order-1 mt-4 md:mt-0">
              <ContractInfo
                selectedPool={contractData}
                defaultRewards={rewardAttributes}
              />
            </div>
            <div className="col-span-2 order-1 md:order-2">
              {(
                <ChartTabs
                  totalLiquidity={totalLiquidity}
                  dailyVolume={dailyVolume}
                  dailyFees={dailyFees}
                  liquidityWeights={liquidityWeights}
                  liquidityLabels={liquidityLabels}
                  volumeWeights={volumeWeights}
                  volumeLabels={volumeLabels}
                  feeWeights={feeWeights}
                  feeLabels={feeLabels}
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
      ) : (
        <LoadingWrapper />
      )}
    </main>
  );
}
