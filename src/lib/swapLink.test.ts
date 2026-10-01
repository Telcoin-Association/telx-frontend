import { swapHref } from "./swapLink";

const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

describe("swapHref", () => {
  it("sets the chain and the token to buy", () => {
    expect(swapHref({ chain: "polygon", buy: TEL })).toBe(`/swap?chain=polygon&buy=${TEL}`);
    expect(swapHref({ chain: "polygon", buy: TEL, sell: WETH })).toBe(`/swap?chain=polygon&sell=${WETH}&buy=${TEL}`);
  });

  it("names native ETH the way the swap page does", () => {
    expect(swapHref({ chain: "base", buy: "0x0000000000000000000000000000000000000000" })).toBe("/swap?chain=base&buy=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
  });

  it("leaves out a chain the swap page does not serve", () => {
    expect(swapHref({ chain: "arbitrum", buy: TEL })).toBe(`/swap?buy=${TEL}`);
    expect(swapHref({ chain: undefined, buy: TEL })).toBe(`/swap?buy=${TEL}`);
  });
});
