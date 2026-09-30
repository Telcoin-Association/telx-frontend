import axios from "axios";
import packageJSON from "@/../package.json";
import { apiPreviewRejection } from "@/helpers/previewAuth";
import { SHARED_CACHE_CONTROL, sharedCacheControl } from "@/lib/cacheControl";
import type { RpcRedis } from "@/server/pools/rpc/store";

/**
 * eUSD and eMXN rates from the pool pipeline. The Telcoin rates API does not price them. A failed read only
 * leaves them out; it never fails the route. The Redis client and the pipeline's chain config load on first
 * use, so a request the preview login rejects loads neither.
 */
async function readPipelineRates(): Promise<Record<string, { USD: string }>> {
  try {
    const [{ getRedis }, { pipelineRates }] = await Promise.all([import("@/server/pools/redis"), import("@/server/pools/rpc/pipelineRates")]);
    return await pipelineRates(getRedis() as unknown as RpcRedis);
  } catch (error) {
    console.error(`Pipeline rates could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export async function GET(request: Request) {
  const rejected = await apiPreviewRejection(request);
  if (rejected) return rejected;

  const baseUrl =
    process.env.NODE_ENV === "production"
      ? "https://api.telco.in"
      : "https://api.dawnstar.telcoin.solutions";

  const url = `${baseUrl}/${process.env.TELCOIN_API_KEY}/rates?bases=TEL,DQUICK,DFX,USDC,WETH,WPOL,WBTC,BAL,AAVE,USDCe&targets=USD`;
  try {
    const pipeline = readPipelineRates();
    const response = await axios.get(url, {
      headers: {
        "X-API-Version": "3.0.0",
        "User-Agent": `TELx.Network/${packageJSON?.version || "2.0.0"
          } Vercel Serverless Function`,
      },
    });

    // The rates are the same for every visitor, so the CDN may serve them.
    return new Response(JSON.stringify({ ...(await pipeline), ...response.data }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": sharedCacheControl(SHARED_CACHE_CONTROL) },
    });
  } catch (error: any) {
    console.error("Error Geting Market Rates:", error?.message);
    console.error(JSON.stringify(error?.response?.data, null, 2));

    return new Response(
      JSON.stringify({ error: "Failed to fetch market rates" }),
      { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  }
}
