import React from "react";
import Image from "next/image";
import globeIcon from "../../../public/icons/globe.png";

export default function ArchiveSnapshotLabels() {
  return (
    <div className={["bg-oce an-gradient sticky top-[64px] z-10 rounded-t-2xl bg-gradient-to-r from-[#19245d] to-[#3057A6]"].join(" ")}>
      <div className="text-white-100 mx-auto grid w-full grid-cols-[0.3fr_1fr_0.5fr_1fr_1fr_1fr] items-center px-4 py-3 lg:grid-cols-[0.4fr_2.5fr_0.5fr_1fr_1fr_1fr]">
        <div>
          <Image src={globeIcon} alt="chain" width={22} height={22} />
        </div>
        <p className="text-xs text-primary">Pool</p>
        <p className="text-center text-xs text-primary">Protocol</p>
        <p className="text-xs text-primary">Status</p>
        <p className="text-xs text-primary">Stake Address</p>
        <p className="text-xs text-primary">Period</p>
      </div>
    </div>
  );
}
