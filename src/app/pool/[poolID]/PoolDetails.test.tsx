import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PoolDetails from "./PoolDetails";

const mockState: { contracts: Record<string, any> } = { contracts: {} };
const mockSearch = { chain: null as string | null };

jest.mock("viem/chains", () => ({ base: { id: 8453 }, mainnet: { id: 1 }, polygon: { id: 137 } }));
jest.mock("next/navigation", () => ({ useSearchParams: () => ({ get: () => mockSearch.chain }) }));
jest.mock("../../../redux/hooks", () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));
jest.mock("../../../redux/slices/contractsSlice", () => ({
  contractsSelector: (s: any) => s.contracts.contracts,
  deprecatedPoolsListSelector: (s: any) => s.contracts.deprecatedPools,
  hasFetchedDataSelector: (s: any) => s.contracts.hasFetchedData,
  contractsLoadingSelector: (s: any) => s.contracts.loading,
}));
jest.mock("../../../hooks/useCheckChain", () => ({ useCheckChain: jest.fn() }));
jest.mock("../../../components/chart/chart", () => ({ getChartData: () => ({}) }));
jest.mock("../../../components/contract/ContractActions", () => function ContractActions() {
  return null;
});
jest.mock("../../../components/contract/ContractInfo", () => function ContractInfo() {
  return null;
});
jest.mock("../../../components/chart/ChartTabs", () => function ChartTabs() {
  return null;
});
jest.mock("../../../components/pool/BridgeTelNote", () => function BridgeTelNote() {
  return null;
});
jest.mock("../../../components/pool/PoolDataAge", () => function PoolDataAge() {
  return null;
});
jest.mock("../../../components/common/PoolHeading", () => function PoolHeading({ contractData }: { contractData: any }) {
  return <h2>{`${contractData.blockchain}:${contractData.poolContractAddress}`}</h2>;
});
jest.mock("../../../components/pool/PoolDetailsSkeleton", () => function PoolDetailsSkeleton() {
  return <p>Loading pool</p>;
});

const V4 = "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982";
const DFX = "0x7E4a73278D6e578aF34FAAAba76eD29583AC0341";
const pool = (poolContractAddress: string, blockchain: string, active = true) => ({ poolContractAddress, blockchain, active, assets: [] });

function setState(overrides: Record<string, unknown> = {}) {
  mockState.contracts = {
    contracts: { [`polygon:${V4}`]: pool(V4, "polygon"), [`base:${V4}`]: pool(V4, "base") },
    deprecatedPools: { [DFX]: pool(DFX, "polygon", false) },
    hasFetchedData: true,
    loading: false,
    ...overrides,
  };
}

const renderPage = (poolID: string) => render(<PoolDetails poolID={poolID} defaultRewards={[]} notices={[]} />);

beforeEach(() => {
  mockSearch.chain = null;
  setState();
});

describe("PoolDetails", () => {
  it("opens the pool on the chain the link names", () => {
    mockSearch.chain = "base";
    renderPage(V4);
    expect(screen.getByRole("heading", { name: `base:${V4}` })).toBeInTheDocument();
  });

  it("opens a legacy pool from a lowercased link", () => {
    renderPage(DFX.toLowerCase());
    expect(screen.getByRole("heading", { name: `polygon:${DFX}` })).toBeInTheDocument();
  });

  it("offers the networks when a pool on several is opened without ?chain=", () => {
    renderPage(V4);
    expect(screen.getByText("This pool is on several networks.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Polygon" })).toHaveAttribute("href", `/pool/${V4}?chain=polygon`);
    expect(screen.getByRole("link", { name: "Base" })).toHaveAttribute("href", `/pool/${V4}?chain=base`);
  });

  it("says the pool was not found once the data has loaded, instead of loading forever", () => {
    renderPage("0xdeadbeef");
    expect(screen.getByText("Pool not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all pools" })).toHaveAttribute("href", "/pools");
    expect(screen.queryByText("Loading pool")).not.toBeInTheDocument();
  });

  it("shows the skeleton while the first load is running", () => {
    setState({ contracts: {}, deprecatedPools: {}, hasFetchedData: false, loading: true });
    renderPage(V4);
    expect(screen.getByText("Loading pool")).toBeInTheDocument();
  });
});
