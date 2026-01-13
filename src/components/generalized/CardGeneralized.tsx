import React from "react";
import GeneralizedPools from "./GeneralizedPools";
import Link from "next/link";

interface PageGeneralizedAttributes {
  title?: string;
  description?: string;
  contracts: any[];
}

interface CardGeneralizedProps {
  page: PageGeneralizedAttributes;
  defaultTelRewards: any;
}

export default function CardGeneralized({ page }: CardGeneralizedProps) {
  const { contracts } = page;

  return (
    <Link href={`pools/generalized-incentives`}>
      <div className="contract-section mx-auto">{contracts && <GeneralizedPools contracts={contracts} />}</div>
    </Link>
  );
}
