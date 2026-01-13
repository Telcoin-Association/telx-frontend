import React from "react";
import Image, { StaticImageData } from "next/image";
import base from "../../../public/logos/base-logo.png";
import polygon from "../../../public/logos/polygon-logo.png";

const chainLogos: Record<string, StaticImageData> = {
  polygon,
  base,
};

const ChainLogo = ({ chain, size = 25, className }: { chain: string | null; size?: number; className?: string }) => {
  chain = chain ? chain.toLowerCase() : null;
  const imageSrc = chain ? chainLogos[chain] : null;

  return chain && imageSrc ? <Image className={[className].join(" ")} src={imageSrc} alt={chain} width={size} height={size} /> : null;
};

export default ChainLogo;
