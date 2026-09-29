import { stringNumbertoUSD } from "@/helpers/returnNumber";

/**
 * Text for a pool amount (TVL, 24h volume, 24h fees): a dollar amount for any number including 0, and
 * "Unavailable" for an unknown value.
 */
export function formatPoolAmount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "Unavailable";
  return `$${stringNumbertoUSD(value)}`;
}
