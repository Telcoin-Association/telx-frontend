// lib/covalent.ts
export interface PoolSummary {
  id: string;
//   totalValueLockedUSD: number;
//   feesUSD: number;
}

export interface HourlySnapshot {
  periodStartUnix: string;
  volumeUSD: number;
  feesUSD: number;
}

export interface DailySnapshot {
  timestamp: string;
  tvlUSD: number;
  volumeUSD: number;
  feesUSD: number;
}

const API_KEY = process.env.NEXT_PUBLIC_COVALENT_API_KEY!;
const BASE_URL = "https://api.covalenthq.com/v1";
const CHAIN_ID = 8453; // Ethereum mainnet (change if needed)

export async function fetchPoolSummary(poolAddress: string): Promise<PoolSummary> {
  const res = await fetch(`${BASE_URL}/${CHAIN_ID}/xy=k/uniswap_v3/pools/address/${poolAddress}/?key=${API_KEY}`);
  const json = await res.json();
  console.log(json, "json");
  const pool = json?.data?.items[0];

  return {
    id: " pool.pool_address",
    // totalValueLockedUSD: pool.total_liquidity_quote,
    // feesUSD: pool.fees_24h_quote,
  };
}

export async function fetchHourlySnapshots(poolAddress: string): Promise<HourlySnapshot[]> {
  const now = Math.floor(Date.now() / 1000);
  const yesterday = now - 24 * 60 * 60;

  const res = await fetch(
    `${BASE_URL}/${CHAIN_ID}/xy=k/uniswap_v3/pools/address/${poolAddress}/transactions/?starting-block=${yesterday}&ending-block=${now}&key=${API_KEY}`,
  );
  const json = await res.json();
  console.log(json, "json");

  return json.data.items.map((s: any) => ({
    periodStartUnix: s.dt,
    volumeUSD: s.volume_quote,
    feesUSD: s.fees_quote,
  }));
}

export async function fetchDailySnapshots(poolAddress: string): Promise<DailySnapshot[]> {
  const res = await fetch(`${BASE_URL}/${CHAIN_ID}/xy=k/uniswap_v3/pools/address/${poolAddress}/history/?key=${API_KEY}`);
  const json = await res.json();

  console.log(json, "json");

  return json?.data?.items?.map((d: any) => ({
    timestamp: d.date,
    tvlUSD: d.liquidity_quote,
    volumeUSD: d.volume_quote,
    feesUSD: d.fees_quote,
  }));
}
