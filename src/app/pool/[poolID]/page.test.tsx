import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import pools from "@/data/pool.json";
import Page, { generateStaticParams } from "./page";

jest.mock("./PoolDetails", () =>
  function PoolDetails({ poolID }: { poolID: string }) {
    return <div data-testid="pool-details">{poolID}</div>;
  },
);

const WETH_TEL_POLYGON = "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d";

describe("pool page params", () => {
  it("fills the poolID segment for every registry pool, once per id", async () => {
    const params = await generateStaticParams();
    const ids = params.map((p) => p.poolID);

    expect(params.every((p) => Object.keys(p).join() === "poolID")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(pools.map((p) => p.attributes.pool_address)));
    expect(ids).toContain(WETH_TEL_POLYGON);
  });

  it("passes the poolID segment to PoolDetails", async () => {
    render(await Page({ params: Promise.resolve({ poolID: WETH_TEL_POLYGON }) }));
    expect(screen.getByTestId("pool-details")).toHaveTextContent(WETH_TEL_POLYGON);
  });
});
