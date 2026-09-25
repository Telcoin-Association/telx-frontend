import React from "react";
import Image from "next/image";
import { getTokenIconKey } from "@/lib/tokens";

// Import all token icons
import aavePng from "../../../public/coins/aave.png";
import aaveSvg from "../../../public/coins/aave.svg";
import ape from "../../../public/coins/ape.png";
import axs from "../../../public/coins/axs.png";
import bal from "../../../public/coins/bal.png";
import cadc from "../../../public/coins/cadc.png";
import crv from "../../../public/coins/crv.png";
import dfx from "../../../public/coins/dfx.png";
import dquick from "../../../public/coins/dquick.png";
import eth from "../../../public/coins/eth.png";
import eurs from "../../../public/coins/eurs.png";
import ghst from "../../../public/coins/ghst.png";
import grt from "../../../public/coins/grt.png";
import ldo from "../../../public/coins/ldo.png";
import link from "../../../public/coins/link.png";
import mana from "../../../public/coins/mana.png";
import matic from "../../../public/coins/matic.png";
import mkr from "../../../public/coins/mkr.png";
import mocean from "../../../public/coins/mocean.png";
import ocean from "../../../public/coins/ocean.png";
import pyr from "../../../public/coins/pyr.png";
import quick from "../../../public/coins/quick.png";
import sand from "../../../public/coins/sand.png";
import sol from "../../../public/coins/sol.png";
import sushi from "../../../public/coins/sushi.png";
import tel from "../../../public/coins/tel.png";
import uni from "../../../public/coins/uni.png";
import usdc from "../../../public/coins/usdc.png";
import usdt from "../../../public/coins/usdt.png";
import wbtc from "../../../public/coins/wbtc.png";
import weth from "../../../public/coins/weth.png";
import wmatic from "../../../public/coins/wmatic.png";
import xsgd from "../../../public/coins/xsgd.png";
import emxn from "../../../public/coins/emxn.png";
import eusd from "../../../public/coins/eUSD.png";

// Map of tickers to images
const coinImages: Record<string, any> = {
  aave: aavePng,
  aave_svg: aaveSvg, // if needed separately
  ape,
  axs,
  bal,
  cadc,
  crv,
  dfx,
  dquick,
  eth,
  eurs,
  ghst,
  grt,
  ldo,
  link,
  mana,
  matic,
  mkr,
  mocean,
  ocean,
  pyr,
  quick,
  sand,
  sol,
  sushi,
  tel: tel, // or tel32/tel64 as needed
  // SVGs are imported as React components here, so use the public path
  tel_legacy: "/coins/tel-legacy.svg",
  uni,
  usdc,
  usdt,
  wbtc,
  weth,
  wmatic,
  xsgd,
  emxn,
  eusd,
};

const ReturnAsset:any = ({
  ticker,
  size = 16,
  className,
  legacy = false,
}: {
  ticker: string | null;
  size?: number;
  className?: string;
  // legacy TEL shows the greyed-out logo
  legacy?: boolean;
}) => {
  ticker = ticker ? ticker.toLowerCase() : null;
  const imageSrc = ticker ? coinImages[getTokenIconKey(ticker, legacy)] : null;

  return ticker && imageSrc ? (
      <Image
        className={[className].join(" ")}
        src={imageSrc}
        alt={ticker}
        width={size}
        height={size}
      />
  ) : (
    null
  );
};

export default ReturnAsset;
