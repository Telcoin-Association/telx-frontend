import { NATIVE_TOKEN, uniswapSwapUrl } from "./tokens";

const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("uniswapSwapUrl", () => {
  it("prefills Uniswap's swap with the chain and both tokens", () => {
    expect(uniswapSwapUrl("base", USDC, TEL)).toBe(`https://app.uniswap.org/swap?chain=base&inputCurrency=${USDC}&outputCurrency=${TEL}`);
  });

  it("names native ETH as ETH, and leaves native POL for the visitor to pick", () => {
    expect(uniswapSwapUrl("ethereum", NATIVE_TOKEN, TEL)).toBe(`https://app.uniswap.org/swap?chain=mainnet&inputCurrency=ETH&outputCurrency=${TEL}`);
    expect(uniswapSwapUrl("polygon", NATIVE_TOKEN, TEL)).toBe(`https://app.uniswap.org/swap?chain=polygon&outputCurrency=${TEL}`);
  });

  it("links the chain alone before tokens are chosen", () => {
    expect(uniswapSwapUrl("polygon", undefined, undefined)).toBe("https://app.uniswap.org/swap?chain=polygon");
  });
});
