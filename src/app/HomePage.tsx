"use client";

import React, { useMemo } from "react";
import UserOwnedSection from "@/components/home/UserOwnedSection";
import TELxLaunchesSection from "@/components/home/TELxLaunchesSection";
import { useAppSelector } from "@/redux/hooks";
import { contractsSelector } from "@/redux/slices/contractsSlice";
import HowItWorks from "@/components/home/HowItWorks";
import PoolsHomePage from "@/components/home/PoolsHomePage";
import homeBg from "../../public/backgrounds/home-page-bg-image.webp";
import Image from "next/image";
import StatsCards from "@/components/home/Stats";
import defaultRewards from "@/data/defaultRewards.json"
import miningContracts from "@/data/pool.json"
import { getPoolMapKey, sortPoolsByNetwork } from "@/lib/contracts"

export default function HomePage({ aboutProductsAttributes, heroAttributes, howItWorksAttributes, overviewAttributes, phasesAttributes }: any) {
  const contracts = useAppSelector(contractsSelector);

  const activeContracts = useMemo(() => {
    if (contracts && Object.values(contracts).length > 0 && miningContracts) {
      const activeContractsList = sortPoolsByNetwork(miningContracts?.filter((contract: any) => contract?.attributes?.active));
      return activeContractsList
        ?.map((contract: any) => {
          const poolAddress = contract?.attributes?.pool_address;
          if (poolAddress) {
            const key = getPoolMapKey(
              poolAddress,
              contract?.attributes?.blockchain,
              contract?.attributes?.protocol
            );
            return contracts[key] || contracts[poolAddress];
          }
        })
        .filter(Boolean);
    }
    return [];
  }, [contracts]);

  return (
    <div>
      <main className="bg-[url('../../public/backgrounds/home-page-bg-image.webp')] md:bg-none"
        style={{
          backgroundPosition: "50% 20px",
          backgroundRepeat: "no-repeat",
          backgroundSize: "1000px 1000px"
        }}
      >
        <section className="px-4 py-20 bg-contain bg-center bg-no-repeat bg-[url('../../public/bac kgrounds/home-page-bg-image.webp')]">
          <Image src={homeBg} alt={""} width={700} height={700} priority className="absolute top-0 h-158.25 w-158.25 hidden md:block" />
          <div className={`mx-auto flex w-full flex-col bg-cover bg-center `}>
            <div className="w-full max-w-7xl md:mx-auto md:flex md:flex-col">
              <div className="mb-10 ml-auto w-full max-w-3xl">
                <StatsCards />
              </div>
              <div className="my-14 flex flex-col gap-4">
                <h1 className="text-white-100 w-auto text-4xl leading-[150%]! md:leading-14! ">{heroAttributes?.title}</h1>
                <h3 className="text-xl text-primary">Power a global marketplace of user-owned financial products. Take control of your assets and Pay Yourself.</h3>
              </div>
              <PoolsHomePage activeContracts={activeContracts} defaultRewards={defaultRewards[0]?.attributes} />
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-7xl flex-col justify-center gap-4 md:flex-row h-full">
            <TELxLaunchesSection productsTitle={aboutProductsAttributes?.title} productsDescription={aboutProductsAttributes?.description} />
            <UserOwnedSection overviewTitle={overviewAttributes?.title} overviewDescription={overviewAttributes?.description} />
          </div>
          <HowItWorks
            howItWorksTitle={howItWorksAttributes?.title}
            howItWorksDescription={howItWorksAttributes?.description}
            howItWorksFeatures={phasesAttributes}
          />
        </section>
      </main>
    </div>
  );
}
