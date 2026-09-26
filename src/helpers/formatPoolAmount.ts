import { stringNumbertoUSD } from "@/helpers/returnNumber";

/**
 * Text for a pool amount (TVL, 24h volume, 24h fees): a dollar amount for any number including 0,
 * "Unavailable" for an unknown value, and "No historical data" for DFX, which has no data source.
 */
export function formatPoolAmount(value: number | null | undefined, protocol?: string): string {
  if (protocol === "dfx") return "No historical data";
  if (value == null || Number.isNaN(value)) return "Unavailable";
  return `$${stringNumbertoUSD(value)}`;
}
