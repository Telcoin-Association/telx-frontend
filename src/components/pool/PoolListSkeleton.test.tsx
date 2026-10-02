import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import contractsReducer, { fetchAllContractData, initializeList, LOAD_RETRY_DELAYS_MS } from "../../redux/slices/contractsSlice";
import pools from "../../data/pool.json";
import type { miningContractFields } from "../../helpers/normalizeMiningContracts";
import PoolListSkeleton from "./PoolListSkeleton";
import PoolDetailsSkeleton from "./PoolDetailsSkeleton";

jest.mock("../common/ChainLogo", () => function MockChainLogo({ chain }: { chain: string }) {
  return <span data-testid="chain">{chain}</span>;
});
jest.mock("../common/ProtocolVersionLogo", () => function MockProtocolVersionLogo({ protocol }: { protocol: string }) {
  return <span data-testid="protocol">{protocol}</span>;
});
jest.mock("./PoolWeightChip", () => function MockPoolWeightChip({ asset }: { asset: { ticker: string } }) {
  return <span>{asset.ticker}</span>;
});
jest.mock("./PoolSnapshotLabels", () => function MockPoolSnapshotLabels() {
  return <div>labels</div>;
});

const makeStore = ({ registry = true, failed = false } = {}) => {
  const store = configureStore({ reducer: { contracts: contractsReducer } });
  if (registry) store.dispatch(initializeList(pools as miningContractFields[]));
  if (failed) {
    for (let i = 0; i <= LOAD_RETRY_DELAYS_MS.length; i++) {
      store.dispatch(fetchAllContractData.rejected(new Error("down"), `r${i}`, undefined));
    }
  }
  return store;
};

const activeCount = (pools as miningContractFields[]).filter((p) => p.attributes?.active && !p.attributes?.hidden).length;

describe("PoolListSkeleton", () => {
  it("with columns auto, leaves out Protocol when every active pool shares it, and with cards adds a card per pool", () => {
    render(
      <Provider store={makeStore()}>
        <PoolListSkeleton byNetwork columns="auto" cards />
      </Provider>,
    );
    // Each pool appears once as a card and once as a table row; the CSS shows one of them per screen width.
    expect(screen.getAllByTestId("chain")).toHaveLength(activeCount * 2);
    expect(screen.queryByTestId("protocol")).not.toBeInTheDocument();
    expect(screen.getAllByText("Volume (24hr)")).toHaveLength(activeCount);
  });

  it("lays out a row per active registry pool with its chain and tokens before the data loads", () => {
    render(
      <Provider store={makeStore()}>
        <PoolListSkeleton />
      </Provider>,
    );
    expect(screen.getAllByTestId("chain")).toHaveLength(activeCount);
    expect(screen.getAllByText("TEL").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading pools")).toHaveAttribute("aria-busy", "true");
  });

  it("limits the rows and orders them by network like the home page", () => {
    render(
      <Provider store={makeStore()}>
        <PoolListSkeleton limit={2} byNetwork />
      </Provider>,
    );
    expect(screen.getAllByTestId("chain").map((el) => el.textContent)).toEqual(["polygon", "polygon"]);
  });

  it("shows placeholder rows before the registry is in the store", () => {
    render(
      <Provider store={makeStore({ registry: false })}>
        <PoolListSkeleton />
      </Provider>,
    );
    expect(screen.queryByTestId("chain")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("reads Unavailable instead of pulsing once the load has failed for good", () => {
    render(
      <Provider store={makeStore({ failed: true })}>
        <PoolListSkeleton />
      </Provider>,
    );
    expect(screen.getAllByText("Unavailable")).toHaveLength(activeCount * 5);
    expect(screen.getAllByTestId("skeleton")).toHaveLength(activeCount);
    expect(screen.getByLabelText("Loading pools")).toHaveAttribute("aria-busy", "false");
  });
});

describe("PoolDetailsSkeleton", () => {
  it("keeps the page layout while loading", () => {
    render(
      <Provider store={makeStore()}>
        <PoolDetailsSkeleton />
      </Provider>,
    );
    expect(screen.getByRole("link", { name: "Pools" })).toHaveAttribute("href", "/pools");
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("says the data could not be loaded once retries are exhausted", () => {
    render(
      <Provider store={makeStore({ failed: true })}>
        <PoolDetailsSkeleton />
      </Provider>,
    );
    expect(screen.getByText("Pool data could not be loaded. Reload the page to try again.")).toBeInTheDocument();
  });
});
