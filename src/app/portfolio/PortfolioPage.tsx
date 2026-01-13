"use client";

import React from "react";
import ProductRewardsMain from "@/components/Portfolio/ProductRewardsMain";
import defaultRewards from "@/data/defaultRewards.json"
import notices from "@/data/notices.json"

export default function PortfolioPage() {

  return (
    <div className="max-w-7xl mx-auto">
      <ProductRewardsMain
        notices={notices}
        defaultRewards={defaultRewards}
      />
    </div>
  );
}
