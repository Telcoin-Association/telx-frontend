import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import pools from "@/data/pool.json";
import Page, { generateMetadata, generateStaticParams } from "./page";

jest.mock(
  "./PoolDetails",
  () =>
    function PoolDetails({ poolID }: { poolID: string }) {
      return <div data-testid="pool-details">{poolID}</div>;
    },
);

jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const WETH_TEL_POLYGON = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";
const HIDDEN_EUSD_TEL_ETHEREUM = "0xd6771c30706f7933f3b1b1ac83f2f82c58673f556157e0414b1968702a5088d0";
const DFX_USDC_EURS = "0x7E4a73278D6e578aF34FAAAba76eD29583AC0341";

describe("pool page params", () => {
  it("fills the poolID segment for every registry pool the app shows, once per id", async () => {
    const params = await generateStaticParams();
    const ids = params.map(p => p.poolID);

    expect(params.every(p => Object.keys(p).join() === "poolID")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(pools.filter(p => !(p.attributes as { hidden?: boolean }).hidden).map(p => p.attributes.pool_address)));
    expect(ids).toContain(WETH_TEL_POLYGON);
    expect(ids).not.toContain(HIDDEN_EUSD_TEL_ETHEREUM);
  });

  it("answers 404 for an id the registry does not list, and for a hidden pool", async () => {
    await expect(Page({ params: Promise.resolve({ poolID: "0xdeadbeef" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(Page({ params: Promise.resolve({ poolID: HIDDEN_EUSD_TEL_ETHEREUM }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders a listed id whatever its case", async () => {
    render(await Page({ params: Promise.resolve({ poolID: DFX_USDC_EURS.toLowerCase() }) }));
    expect(screen.getByTestId("pool-details")).toHaveTextContent(DFX_USDC_EURS.toLowerCase());
  });

  it("passes the poolID segment to PoolDetails", async () => {
    render(await Page({ params: Promise.resolve({ poolID: WETH_TEL_POLYGON }) }));
    expect(screen.getByTestId("pool-details")).toHaveTextContent(WETH_TEL_POLYGON);
  });
});

describe("pool page metadata", () => {
  it("titles the page from its tokens and chain rather than the registry name", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ poolID: WETH_TEL_POLYGON }) });
    expect(metadata.title).toBe("WETH/TEL on Polygon | TELx");
    expect(metadata.openGraph.title).toBe("WETH/TEL on Polygon | TELx");
    expect(JSON.stringify(metadata)).not.toMatch(/merkl/i);
  });

  it("uses the generic title for an unknown id", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ poolID: "0xdeadbeef" }) });
    expect(metadata.title).toBe("Pool Details | TELx");
    expect(metadata.openGraph.title).toBe("Pool Details | TELx");
  });
});
