import { getTokenPrices } from "./getTokenPrices";

let cached: Record<string, number> | null = null;
let cachedAt = 0;
let inflight: Promise<Record<string, number>> | null = null;
const TTL = 60_000;

export async function getTokenPricesCached() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const prices = await getTokenPrices();
    cached = prices;
    cachedAt = Date.now();
    return prices;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
