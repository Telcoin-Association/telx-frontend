import { Alchemy, Network } from "alchemy-sdk";
import { AlchemyProvider } from "ethers";

const apiKey = process.env.NEXT_PUBLIC_ALCHEMY_ID;

const settingsPolygon = {
  apiKey: apiKey,
  network: Network.MATIC_MAINNET, // For Polygon mainnet
};
const settingsBase = {
  apiKey: apiKey,
  network: Network.BASE_MAINNET, // ✅ Base network for now
};

export const alchemySdk = new Alchemy(settingsPolygon);
export const alchemySdkBase = new Alchemy(settingsBase);

// Get the provider instance
export const provider = new AlchemyProvider("matic", settingsPolygon.apiKey);
export const providerBase = new AlchemyProvider("base", settingsPolygon.apiKey);