import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PoolsMain from "./PoolsMain";
import ArchivePage from "./ArchivePage";
import PoolTabs from "./PoolTabs";
import { getPoolMapKey } from "../../lib/contracts";
import type { miningContractFields } from "../../helpers/normalizeMiningContracts";

const mockStore: { contracts: Record<string, unknown>; archive: Record<string, unknown> } = { contracts: {}, archive: {} };
jest.mock("../../redux/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ contracts: { contracts: mockStore.contracts, deprecatedPools: mockStore.archive } }),
}));
jest.mock("../../redux/slices/contractsSlice", () => ({
  contractsSelector: (state: { contracts: { contracts: unknown } }) => state.contracts.contracts,
  deprecatedPoolsListSelector: (state: { contracts: { deprecatedPools: unknown } }) => state.contracts.deprecatedPools,
}));
jest.mock("../../hooks/useNow", () => ({ useNow: () => Date.UTC(2026, 9, 1, 12) }));
jest.mock("../pool/PoolSnapshot", () => function MockPoolSnapshot({ contractData }: { contractData: { poolContractAddress: string } }) {
  return <div data-testid="row">{contractData.poolContractAddress}</div>;
});
jest.mock("../archive/ArchiveCards", () => function MockArchiveCards({ contractsData }: { contractsData: { poolContractAddress: string }[] }) {
  return contractsData.length > 0 ? (
    <div>{contractsData.map((pool) => <div data-testid="archive-row" key={pool.poolContractAddress}>{pool.poolContractAddress}</div>)}</div>
  ) : (
    <div>loading archive</div>
  );
});
jest.mock("../pool/PoolListSkeleton", () => function MockPoolListSkeleton() {
  return <div>skeleton</div>;
});
jest.mock("../common/HelpTip", () => function MockHelpTip() {
  return null;
});
jest.mock("next/image", () => function MockImage() {
  return null;
});

const assets = (...tickers: string[]) => tickers.map((ticker) => ({ ticker, weight: 50 }));
const entry = (address: string, blockchain: string): miningContractFields =>
  ({ attributes: { pool_address: address, blockchain, protocol: "uniswap", active: true } }) as unknown as miningContractFields;
const registry = [entry("0xweth-tel", "polygon"), entry("0xeusd-emxn", "polygon"), entry("0xeth-tel", "base"), entry("0xusdce-tel", "ethereum")];

const loaded = (address: string, blockchain: string, tickers: string[]) => ({
  [getPoolMapKey(address, blockchain, "uniswap")]: { poolContractAddress: address, blockchain, protocol: "uniswap", totalLiquidity: 100, assets: assets(...tickers) },
});

beforeEach(() => {
  window.history.replaceState(null, "", "/pools");
  mockStore.contracts = {
    ...loaded("0xweth-tel", "polygon", ["WETH", "TEL"]),
    ...loaded("0xeusd-emxn", "polygon", ["eUSD", "eMXN"]),
    ...loaded("0xeth-tel", "base", ["ETH", "TEL"]),
    ...loaded("0xusdce-tel", "ethereum", ["USDC.e", "TEL"]),
  };
  mockStore.archive = {
    a: { poolContractAddress: "0xold-bal", blockchain: "polygon", assets: assets("TEL", "BAL") },
    b: { poolContractAddress: "0xold-usdc", blockchain: "polygon", assets: assets("TEL", "USDC") },
    c: { poolContractAddress: "0xold-eth", blockchain: "ethereum", assets: assets("TEL", "WETH") },
  };
});

const rows = () => screen.queryAllByTestId("row").map((row) => row.textContent);
const archiveRows = () => screen.queryAllByTestId("archive-row").map((row) => row.textContent);

describe("Pools page token filters", () => {
  it("searches by token symbol or name and keeps the search in the URL", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);
    await user.type(screen.getByRole("searchbox", { name: "Search pools by token" }), "peso");
    expect(rows()).toEqual(["0xeusd-emxn"]);
    expect(window.location.search).toBe("?q=peso");

    await user.clear(screen.getByRole("searchbox", { name: "Search pools by token" }));
    await user.type(screen.getByRole("searchbox", { name: "Search pools by token" }), "usdc");
    expect(rows()).toEqual(["0xusdce-tel"]);
  });

  it("lists every token in the pools with counts, and filters by any or all of the checked ones", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);
    await user.click(screen.getByRole("button", { name: "Tokens" }));
    const panel = screen.getByRole("group", { name: "Filter pools by token" });
    expect(within(panel).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["TEL3", "ETH / WETH2", "eMXN1", "eUSD1", "USDC.e1"]);

    await user.click(within(panel).getByRole("checkbox", { name: /ETH \/ WETH/ }));
    await user.click(within(panel).getByRole("checkbox", { name: /eMXN/ }));
    expect(rows()).toEqual(["0xweth-tel", "0xeusd-emxn", "0xeth-tel"]);
    expect(screen.getByRole("button", { name: "Tokens (2)" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("checkbox", { name: /eMXN/ }));
    await user.click(within(panel).getByRole("checkbox", { name: /^TEL/ }));
    await user.click(within(panel).getByRole("checkbox", { name: "Match all" }));
    expect(rows()).toEqual(["0xweth-tel", "0xeth-tel"]);
    expect(window.location.search).toBe("?tokens=eth%2Ctel&match=all");
  });

  it("counts the chain chips after the token filter and combines with the chain and live toggles", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);
    await user.type(screen.getByRole("searchbox", { name: "Search pools by token" }), "tel");
    expect(screen.getByRole("button", { name: "Polygon (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Base (1)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Base (1)" }));
    expect(rows()).toEqual(["0xeth-tel"]);
    expect(window.location.search).toBe("?q=tel&chain=base");

    await user.click(screen.getByRole("button", { name: "Live rewards only" }));
    expect(screen.getByText("No pools match these filters.")).toBeInTheDocument();
  });

  it("clears the search, tokens, chain and live toggle with Show all pools", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);
    await user.type(screen.getByRole("searchbox", { name: "Search pools by token" }), "nothing-matches");
    expect(rows()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Show all pools" }));
    expect(rows()).toHaveLength(4);
    expect(screen.getByRole("searchbox", { name: "Search pools by token" })).toHaveValue("");
    expect(window.location.search).toBe("");
  });

  it("restores the filters from a shared URL", async () => {
    window.history.replaceState(null, "", "/pools?tokens=emxn&chain=polygon");
    render(<PoolsMain pools={registry} />);
    expect(await screen.findByRole("button", { name: "Tokens (1)" })).toBeInTheDocument();
    expect(rows()).toEqual(["0xeusd-emxn"]);
    expect(screen.getByRole("button", { name: "Polygon (1)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("closes the token list with Escape and returns focus to its button", async () => {
    const user = userEvent.setup();
    render(<PoolsMain pools={registry} />);
    await user.click(screen.getByRole("button", { name: "Tokens" }));
    await user.click(screen.getByRole("checkbox", { name: /eMXN/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Filter pools by token" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tokens (1)" })).toHaveFocus();
  });
});

describe("Archive token filters", () => {
  it("builds the tokens from the archived pools and filters by token and chain", async () => {
    const user = userEvent.setup();
    render(<ArchivePage />);
    expect(archiveRows()).toEqual(["0xold-bal", "0xold-usdc", "0xold-eth"]);

    await user.click(screen.getByRole("button", { name: "Tokens" }));
    const panel = screen.getByRole("group", { name: "Filter archived pools by token" });
    expect(within(panel).getByRole("checkbox", { name: /BAL/ })).toBeInTheDocument();
    await user.click(within(panel).getByRole("checkbox", { name: /BAL/ }));
    expect(archiveRows()).toEqual(["0xold-bal"]);

    await user.click(within(panel).getByRole("button", { name: "Clear selection" }));
    await user.click(screen.getByRole("button", { name: "Ethereum (1)" }));
    expect(archiveRows()).toEqual(["0xold-eth"]);
  });

  it("offers to show all archived pools when the filters match none", async () => {
    const user = userEvent.setup();
    render(<ArchivePage />);
    await user.type(screen.getByRole("searchbox", { name: "Search archived pools by token" }), "emxn");
    expect(screen.getByText("No archived pools match these filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all archived pools" }));
    expect(archiveRows()).toHaveLength(3);
  });
});

describe("Pool tabs", () => {
  it("opens the archive from view=archive with its filters, and clears the filters when switching tabs", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/pools?view=archive&tokens=bal");
    render(<PoolTabs miningContracts={registry} />);
    await waitFor(() => expect(archiveRows()).toEqual(["0xold-bal"]));

    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(window.location.search).toBe("");
    expect(rows()).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(window.location.search).toBe("?view=archive");
    expect(archiveRows()).toHaveLength(3);
  });
});
