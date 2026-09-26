"use client";

import React, { useRef } from "react";
import { useEffect, useState } from "react";
import Footer from "./Footer";
import Header from "./Header";
import { usePathname } from "next/navigation";
import { useAppSelector } from "@/redux/hooks";
import {
  clearLoadError,
  contractsErrorSelector,
  contractsListSelector,
  contractsLoadingSelector,
  failedAttemptsSelector,
  LOAD_RETRY_DELAYS_MS,
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
  const loading = useAppSelector(contractsLoadingSelector);
  const lastError = useAppSelector(contractsErrorSelector);
  const failedAttempts = useAppSelector(failedAttemptsSelector);
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

  const lastAccountRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!contractsList.length) return;

    const accountChanged = lastAccountRef.current !== address;
    const shouldFetch = (!hasFetchedData && contractsList.length > 0) || accountChanged;

    if (!shouldFetch) return;

    lastAccountRef.current = address;
    if (accountChanged) dispatch(clearLoadError());
    dispatch(fetchAllContractData(address));
  }, [contractsList.length, hasFetchedData, address, dispatch]);

  // Retry a failed load with backoff. The cleanup clears a pending retry on unmount and when the
  // account changes (the effect above fetches for the new account).
  useEffect(() => {
    if (!lastError || loading) return;
    const delay = LOAD_RETRY_DELAYS_MS[failedAttempts - 1];
    if (delay === undefined) return;

    const timer = setTimeout(() => dispatch(fetchAllContractData(address)), delay);
    return () => clearTimeout(timer);
  }, [lastError, loading, failedAttempts, address, dispatch]);

  return (
    <div id={mainID}>
      <Header
        mobileNavOpen={mobileNavOpen}
        toggleMobileNavOpen={toggleMobileNavOpen}
        setWalletIsOpen={setWalletIsOpen}
        path={pathname}
        walletIsOpen={walletIsOpen}
      />
      <div id="page" className="pt-16 bg-linear-to-r from-[#19245d] to-[#3057A6]">
        <div className="w-full">
          {props.children}
          <Footer />
        </div>
      </div>
    </div>
  );
}

export default AppLayout;
