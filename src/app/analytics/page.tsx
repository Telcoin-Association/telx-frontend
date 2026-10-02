import React from "react";
import type { Metadata } from "next";
import AnalyticsPage from "@/components/analytics/AnalyticsPage";

export const metadata: Metadata = {
  title: "Analytics | TELx",
  description: "TELx liquidity, Subscribed Value Locked, volume, fees, APR and rewards over time, by chain, pool and campaign.",
  metadataBase: new URL("https://telx.network"),
};

export default function Page() {
  return <AnalyticsPage />;
}
