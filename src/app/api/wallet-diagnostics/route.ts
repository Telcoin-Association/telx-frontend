import { walletDiagnostics } from "@/server/admin/diagnostics";

// The handler and its limits live in src/server/admin/diagnostics.ts.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function GET(request: Request) {
  return walletDiagnostics(request);
}
