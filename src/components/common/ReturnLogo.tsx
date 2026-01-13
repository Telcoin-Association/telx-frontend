import React from "react";
import Image, { StaticImageData } from "next/image";
import QuickswapLogo from "../../../public/logos/logo-quickswap.png";
import DfxLogo from "../../../public/logos/logo-dfx.png";
import SushiLogo from "../../../public/logos/logo-sushi.png";
import PolygonLogo from "../../../public/logos/logo-polygon.png";
import BalancerLogo from "../../../public/logos/logo-balancer.png";
import UniswapLogo from "../../../public/logos/logo-uniswap.png";

interface ReturnLogoProps {
  brand: string | undefined;
  width?: string;
}

const ReturnLogo = (props: ReturnLogoProps) => {
  const { brand, width = "w-20" } = props;
  let logo: StaticImageData;
  switch (brand) {
    case "quickswap":
      logo = QuickswapLogo;
      break;
    case "dfx":
      logo = DfxLogo;
      break;
    case "sushi":
      logo = SushiLogo;
      break;
    case "polygon":
      logo = PolygonLogo;
      break;
    case "balancer":
      logo = BalancerLogo;
      break;
    case "uniswap":
      logo = UniswapLogo;
      break;
    default:
      return null;
  }

  return (
    <div className={width}>
      <Image src={logo} alt={brand} />
    </div>
  );
};

export default ReturnLogo;
