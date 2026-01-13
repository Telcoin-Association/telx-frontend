"use client";

import React from "react";
import { useEffect, useState } from "react";
import Footer from "./Footer";
import Header from "./Header";
import { usePathname } from "next/navigation";
import { useAppSelector } from "@/redux/hooks";
import {
  contractsListSelector,
  fetchAllContractData,
  hasFetchedDataSelector,
  initializeList,
} from "@/redux/slices/contractsSlice";
import { useAppDispatch } from "@/redux/hooks";
import pools from "@/data/pool.json";
import { miningContractFields } from "@/helpers/normalizeMiningContracts";
import { useAccount } from "wagmi";
import { datadogRum } from "@datadog/browser-rum";

interface LayoutProps {
  children: any;
}

export function AppLayout(props: LayoutProps) {
  const hasFetchedData = useAppSelector(hasFetchedDataSelector);
  const [mobileNavOpen, toggleMobileNavOpen] = useState(false);
  const [walletIsOpen, setWalletIsOpen] = useState(true);
  const [mainID, setMainID] = useState("");
  const { address } = useAccount();
  const [lastAccount, setLastAccount] = useState(address);
  const pathname = usePathname();

  const contractsList = useAppSelector(contractsListSelector);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (
      contractsList?.length === 0 &&
      pools &&
      pools?.length > 0
    ) {
      dispatch(initializeList(pools as miningContractFields[]));
    }
  }, [dispatch, contractsList]);

  useEffect(() => {
    let TempMainID = pathname ? pathname.substring(1) : "";
    TempMainID = mainID.includes("/")
      ? mainID.substring(0, mainID.indexOf("/"))
      : mainID;
    TempMainID = mainID.includes("?")
      ? mainID.substring(0, mainID.indexOf("?"))
      : mainID;
    setMainID;
    setMainID(TempMainID);
  }, [pathname, mainID]);

  useEffect(() => {
    if (address) {
      datadogRum.setUser({
        id: address,
      });
    }
  }, [address]);

  useEffect(() => {
    // fetch latest data from blockchain subgraphs if:
    // - we have not fetched said data and the uninitialized contracts are present
    // - OR the connected wallet (`account`) has changed
    if (
      (!hasFetchedData && contractsList.length > 0) ||
      lastAccount !== address
    ) {
      setLastAccount(address);
    }
    dispatch(fetchAllContractData(address));
  }, [contractsList, dispatch, hasFetchedData, address, lastAccount]);

  return (
    <div id={mainID}>
      <Header
        mobileNavOpen={mobileNavOpen}
        toggleMobileNavOpen={toggleMobileNavOpen}
        setWalletIsOpen={setWalletIsOpen}
        path={pathname}
        walletIsOpen={walletIsOpen}
      />
      <div id="page" className="pt-16 bg-gradient-to-r from-[#19245d] to-[#3057A6]">
        <div className="w-full">
          {props.children}
          <Footer />
        </div>
      </div>
    </div>
  );
}

export default AppLayout;
