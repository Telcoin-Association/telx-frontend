import axios from "axios";
import packageJSON from "@/../package.json";

export async function GET() {
  const baseUrl =
    process.env.NODE_ENV === "production"
      ? "https://api.telco.in"
      : "https://api.dawnstar.telcoin.solutions";

  const url = `${baseUrl}/${process.env.TELCOIN_API_KEY}/rates?bases=TEL,DQUICK,DFX,USDC,WETH,WPOL,WBTC,BAL,AAVE,USDCe&targets=USD`;
  try {
    const response = await axios.get(url, {
      headers: {
        "X-API-Version": "3.0.0",
        "User-Agent": `TELx.Network/${packageJSON?.version || "2.0.0"
          } Vercel Serverless Function`,
      },
    });

    return new Response(JSON.stringify(response.data), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error Geting Market Rates:", error?.message);
    console.error(JSON.stringify(error?.response?.data, null, 2));

    return new Response(
      JSON.stringify({ error: "Failed to fetch market rates" }),
      { status: 500 }
    );
  }
}
