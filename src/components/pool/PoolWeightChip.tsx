import React from "react";
import Image from "next/image";
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

// Map of tickers to images
export const coinImages: Record<string, any> = {
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
  uni,
  usdc,
  usdt,
  wbtc,
  weth,
  wmatic,
  xsgd,
  emxn,
  eusd: usdc,
};

export default function PoolWeightChip({
  asset,
  className,
}: {
  asset: {
    ticker: string;
    weight: number;
  };
  className?: string;
}) {
  const { ticker, weight } = asset;
  const tickerName = ticker ? ticker.toLowerCase() : "";
  const imageSrc = ticker ? coinImages[tickerName] : null;

  return (
    <div className={["flex items-center rounded-[40px] border border-white/10 px-3 py-2 text-xs group-hover:text-white-100 w-fit gap-[6px]", className].join(" ")}>
      {ticker && imageSrc && <Image src={imageSrc} alt={ticker} width={24} height={24} className="hidden md:block" />}
      {ticker && imageSrc && <Image src={imageSrc} alt={ticker} width={18} height={18} className="md:hidden" />}
      <span className="font-bold text-white text-xs">{ticker} </span>
      <span className="text-primary text-xs">{!isNaN(weight) && `${weight}%`} </span>
    </div>
  );
}
