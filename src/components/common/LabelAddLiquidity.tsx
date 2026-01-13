import React, { useEffect, useRef, useState } from "react";
import { formatProtocol } from "@/helpers/formatProtocol";
import { ProtocolsContractData } from "@/web3/getContracts/shared";
import Link from "next/link";
import { InfoCircle as InfoCircleIcon } from "@transferwise/icons";
import ExtrnalLinkIcon from "../../../public/icons/ExternalLinkIconWhite.svg"

export default function LabelAddLiquidity({ contractData }: { contractData: ProtocolsContractData }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // To close tooltip when the user clicks outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setShowTooltip(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [tooltipRef]);

  const { addLiquidityLink, protocol } = contractData;
  const helpText = "Use this link to stake your crypto and receive an LP Token.";

  return addLiquidityLink ? (
    <div className="flex items-center gap-3 w-fit">
      <Link href={addLiquidityLink} target="_blank" rel="noreferrer" className="w-full text-white py-2 px-3 font-bold bg-ocean-gradient flex gap-1 items-center text-sm text-center rounded-lg hover:scale-105 cursor-pointer duration-200">
        Add Liquidity On {formatProtocol(protocol)}
        <ExtrnalLinkIcon height={20} width={20} />
      </Link>
      <div
        className="relative cursor-pointer text-blue-700 h-fit"
        onClick={() => setShowTooltip(true)}
        ref={tooltipRef}
      >
        {showTooltip && (
          <div
            className="absolute bottom-full right-0 z-10 mt-2 w-60 border border-white/10 rounded-lg bg-theme-gradient p-2 text-sm text-white shadow-lg shadow-blackz md:w-72"
            onMouseLeave={() => setShowTooltip(false)}
          >
            {typeof helpText === "object" ? (
              <div>{helpText}</div>
            ) : (
              <p>{helpText}</p>
            )}
          </div>
        )}
        <InfoCircleIcon />
      </div>
    </div>
  ) : (
    <></>
  );
}
