"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Check as CheckIcon, Documents as CopyIcon, NavigateAway as ExternalLinkIcon } from "@transferwise/icons";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import ReturnAsset from "./ReturnAsset";
import { getTokenExplorerUrl, isLegacyTel } from "@/lib/tokens";

const EXPLORER_NAME_BY_NETWORK: Record<string, string> = {
  ethereum: "Etherscan",
  polygon: "Polygonscan",
  base: "Basescan",
};

const buttonClassName =
  "flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary duration-200";

function CopyAddressButton({ ticker, address, addressId }: { ticker: string; address: string; addressId: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: select the address so it can be copied manually
      const element = document.getElementById(addressId);
      const selection = window.getSelection();
      if (element && selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={buttonClassName}
      aria-label={copied ? `${ticker} address copied` : `Copy ${ticker} address`}
      title={copied ? "Copied" : "Copy address"}
    >
      {copied ? (
        <>
          <CheckIcon />
          <span>Copied</span>
        </>
      ) : (
        <CopyIcon />
      )}
    </button>
  );
}

function TokenAddress({ ticker, address, blockchain }: { ticker: string; address?: string | null; blockchain: string }) {
  const addressId = useId();
  const explorerUrl = getTokenExplorerUrl(blockchain, address);
  const explorerName = EXPLORER_NAME_BY_NETWORK[blockchain] ?? "block explorer";

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ReturnAsset ticker={ticker} size={20} legacy={isLegacyTel(address)} />
          <span className="text-sm font-bold text-white">{ticker}</span>
        </div>
        {address && (
          <div className="flex items-center gap-1">
            <CopyAddressButton ticker={ticker} address={address} addressId={addressId} />
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClassName}
                aria-label={`View ${ticker} on ${explorerName}`}
                title={`View on ${explorerName}`}
              >
                <ExternalLinkIcon />
              </a>
            )}
          </div>
        )}
      </div>
      {/* native ETH has no contract, so its address is left blank */}
      {address && (
        <p id={addressId} className="text-xs break-all text-primary">
          {address}
        </p>
      )}
    </li>
  );
}

export default function LabelTokenAddressesRow({ contractData }: { contractData: ProtocolsContractData }) {
  const { assets, blockchain } = contractData;
  const tokens: { ticker: string; address?: string | null }[] = assets ?? [];

  if (!tokens.some((token) => token.address !== undefined)) return null;

  return (
    <div className="bg-black/20 rounded-2xl p-4 flex flex-col gap-3">
      <h4 className="text-sm text-primary">Token Addresses</h4>
      <ul className="flex flex-col gap-3">
        {tokens.map((token, i) => (
          <TokenAddress key={i} ticker={token.ticker} address={token.address} blockchain={blockchain} />
        ))}
      </ul>
    </div>
  );
}
