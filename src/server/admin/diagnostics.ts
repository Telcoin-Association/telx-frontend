import "server-only";

import { isAddress, type Address } from "viem";

import { apiPreviewRejection } from "@/helpers/previewAuth";
import { WALLET_DIAGNOSTICS_HEADERS, type AdminWalletReport } from "@/lib/adminWallet";
import { createShortCache } from "../shortCache";
import { liveWalletReportDeps } from "./liveDeps";
import { clientKey, createRateLimit } from "./rateLimit";
import { walletReport } from "./walletReport";

/**
 * GET /api/wallet-diagnostics?address=0x...: the wallet troubleshooting report behind /admin/wallet. It reads
 * only public onchain data and Merkl's public rewards, so it has no login of its own. Each request reads
 * several chains, so it is rate limited per client, the work per request is bounded, and one wallet's report
 * is reused on an instance for a minute. Responses are never cached by the CDN or indexed.
 */

export const REPORT_CACHE_TTL_MS = 60_000;
export const REQUESTS_PER_MINUTE = 10;

const reports = createShortCache<AdminWalletReport>({ ttlMs: REPORT_CACHE_TTL_MS, maxEntries: 50 });
const limit = createRateLimit({ limit: REQUESTS_PER_MINUTE, windowMs: 60_000 });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: WALLET_DIAGNOSTICS_HEADERS });

export async function walletDiagnostics(request: Request): Promise<Response> {
  const previewRejected = await apiPreviewRejection(request);
  if (previewRejected) return previewRejected;

  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  if (!isAddress(address, { strict: false })) return json({ error: "Enter a valid wallet address (0x followed by 40 hex characters)." }, 400);

  if (!limit.take(clientKey(request))) return json({ error: "Too many requests. Try again in a minute." }, 429);

  const owner = address.toLowerCase() as Address;
  try {
    return json(await reports.get(owner, () => walletReport(owner, liveWalletReportDeps)));
  } catch (error) {
    console.error("Wallet diagnostics failed:", error);
    return json({ error: "The report couldn't be built. Try again." }, 502);
  }
}

/** Test hook: forget cached reports. */
export function clearWalletReportCache() {
  reports.clear();
}
