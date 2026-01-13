import React from "react";
import Image, { StaticImageData } from "next/image";
import balancer from "../../../public/logos/network/balancer-bal-logo.png";
import dfx from "../../../public/coins/dfx.png";
import quickswap from "../../../public/logos/network/quickswap-logo.png";
import uniswap from "../../../public/logos/network/uniswap-uni-logo.png";

const protocolLogos: Record<string, StaticImageData> = {
  balancer,
  dfx,
  quickswap,
  uniswap,
};

const ProtocolVersionLogo = ({ protocol, protocolVersion, size = 25, className }: { protocol: string | null; protocolVersion?: string | null; size?: number; className?: string }) => {
  protocol = protocol ? protocol.toLowerCase() : null;
  const imageSrc = protocol ? protocolLogos[protocol] : null;

  return protocol && imageSrc ?
    <div className="flex flex-col items-center gap-1 justify-center">
      <Image className={[className].join(" ")} src={imageSrc} alt={protocol} width={size} height={size} />
      {protocolVersion &&
        <p className="text-white text-xs uppercase">{protocolVersion}</p>
      }
    </div>
    :
    null;
};

export default ProtocolVersionLogo;
