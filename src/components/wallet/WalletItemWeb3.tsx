"use client";

import React from "react";
import {
  CheckCircle as CheckCircleIcon,
  CrossCircle as CrossCircleIcon,
} from "@transferwise/icons";
import { useMemo, useState, useEffect } from "react";
import PolygonLogo from "../../../public/logos/logo-polygon.png";
import WalletIcon from "../../../public/icons/wallet.svg";
import Image from "next/image";
import { useAccount, useChainId, useDisconnect } from "wagmi";
import { POLYGON_MAIN_CHAIN_ID } from "@/lib/constants";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import { shortenAddress } from "@/helpers/shortenAddress";
import Button from "../common/Button";
import WalletLabelValue from "./WalletLabelValue";

//TODO: While implementing referesh button, use the below icon
//import { Refresh as RefreshIcon } from "@transferwise/icons";

export default function WalletItemWeb3() {
  const { address, isConnecting, isDisconnected } = useAccount();
  const [hasConnectedBefore, setHasConnectedBefore] = useState(false);
  const [loading, setLoading] = useState(true);
  const chainId = useChainId();
  const { disconnect } = useDisconnect();

  const account = address;
  const isNotPolygon = chainId !== POLYGON_MAIN_CHAIN_ID;

  useEffect(() => {
    if (localStorage.getItem("hasConnectedBefore")) {
      setHasConnectedBefore(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) {
      localStorage.setItem("hasConnectedBefore", "true");
      setHasConnectedBefore(true);
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (isDisconnected) {
      setLoading(false);
    }
  }, [isDisconnected]);

  const walletStatus = useMemo(() => {
    if (isConnecting) {
      return (
        <div className="flex space-x-1 items-center text-sm text-blue-600">
          <p>Checking..</p>
        </div>
      );
    } else if (account) {
      if (isNotPolygon) {
        return (
          <div className="flex space-x-1 items-center text-status-error text-sm">
            <CheckCircleIcon />
            <p>Wrong Network</p>
          </div>
        );
      } else {
        return (
          <div className="flex space-x-1 items-center text-sm md:text-base text-green-700">
            <CheckCircleIcon />
            <p className="text-sm">Connected</p>
          </div>
        );
      }
    } else {
      if (isDisconnected && hasConnectedBefore) {
        return (
          <div className="flex space-x-1 items-center text-sm md:text-base text-status-disconnected">
            <CrossCircleIcon className="text-gray-600" />
            <p className="text-gray-600 text-sm">Disconnected</p>
          </div>
        );
      } else {
        return (
          <div className="flex space-x-1 items-center text-sm md:text-base text-status-disconnected">
            <CrossCircleIcon className="text-gray-600" />
            <p className="text-sm">Not Connected</p>
          </div>
        );
      }
    }
  }, [isConnecting, isNotPolygon, account, isDisconnected, hasConnectedBefore]);

  const walletAddress = useMemo(() => {
    if (account) {
      const polygonScanURL = `https://polygonscan.com/address/${account}`;
      return (
        <a
          href={polygonScanURL}
          target="_blank"
          rel="noreferrer"
          className="text-blue-700 hover:text-purple"
        >
          <span>{shortenAddress(account)}</span>
        </a>
      );
    }

    return <>{shortenAddress("0x0000000000000000000000000000000000")}</>;
  }, [account]);

  const helpText = useMemo(() => {
    if (!account) {
      return (
        <>
          <p className="my-2 text-gray-600 text-sm leading-4">
            Connect your wallet on Polygon and begin staking LP Tokens to gain
            rewards on TELx. TELx supports various wallets on Chrome, Brave,
            FireFox, and Edge desktop browsers.
          </p>
          <div className="py-3">
            <ConnectButton />
          </div>
        </>
      );
    } else if (isNotPolygon) {
      return (
        <p className="my-2 text-gray-1000 text-sm leading-4">
          TELx runs on Polygon. Your wallet is connected, but is currently using
          a different network. Please change your wallet&apos;s network to
          Polygon.
        </p>
      );
    }
    return;
  }, [isNotPolygon, account]);

  return (
    <div className="">
      {loading ? (
        <>
          <LoadingAnimation
            theme="light"
            padding={10}
            message="Loading Wallet Data.."
          />
        </>
      ) : (
        <div
          className={` rounded-xl ${
            account
              ? isNotPolygon
                ? "wrong-network"
                : "connected"
              : "disconnected"
          }`}
        >
          <div>
            <WalletLabelValue label="Wallet" value={walletStatus} />
            <div className="flex justify-between items-center mt-1">
              <div
                className={`flex items-center ${
                  account ? "text-blue-700" : "text-gray-600"
                }`}
              >
                <WalletIcon className="w-6" />
                <div className="ml-1 font-semibold text-xl my-1">
                  <p className="">{walletAddress && walletAddress}</p>
                </div>
              </div>
              <div className="w-20">
                {!isNotPolygon && !account && (
                  <Image
                    className="filter contrast-0 opacity-[0.3]"
                    src={PolygonLogo}
                    alt="Polygon"
                  />
                )}
                {!isNotPolygon && account && (
                  <Image src={PolygonLogo} alt="Polygon" />
                )}
              </div>
            </div>
          </div>
          {account && (
            <div className="mt-1">
              <Button
                external={false}
                linkText="Disconnect"
                onClick={() => disconnect()}
                type="small"
                className="text-xs py-[5px]"
              />
            </div>
          )}
          <div> {helpText}</div>
        </div>
      )}
    </div>
  );
}
