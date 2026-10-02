import React from "react";
import type { Metadata } from "next";
import WalletDiagnosticsPage from "@/components/admin/WalletDiagnosticsPage";

// Not linked from the site's navigation, footer or sitemap. next.config.ts sends it with X-Robots-Tag noindex,
// and rendering per request makes Next send it with Cache-Control no-store.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wallet troubleshooting | TELx",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <WalletDiagnosticsPage />;
}
