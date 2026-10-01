import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { zeroAddress } from "viem";
import AddLiquidityPanel from "./AddLiquidityPanel";
import { MERKL_POLYGON_WETH_TEL_POOLID } from "../../lib/contracts";
import { getSqrtPriceAtTick } from "../../lib/v4/liquidityMath";
import { presetRange, priceAtTick, type TickRange } from "../../lib/v4/range";
import type { PoolReadState, WalletReadState, AddLiquidityPending, AddLiquidityResult } from "../../hooks/useAddLiquidity";

const WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const FAR_FUTURE = 4_000_000_000;
const APPROVED = { erc20ToPermit2: 2n ** 255n, permit2Amount: 2n ** 159n, permit2Expiration: FAR_FUTURE, permit2Nonce: 0 };
const UNAPPROVED = { erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0, permit2Nonce: 0 };

const mockAdd = jest.fn();
const mockReload = jest.fn();
const mockHook: {
  pool: PoolReadState | null;
  wallet: WalletReadState | null;
  loadError: boolean;
  pending: AddLiquidityPending | null;
  result: AddLiquidityResult | null;
} = { pool: null, wallet: null, loadError: false, pending: null, result: null };
const mockAccount: { address: string | undefined; chain: { id: number } | undefined } = { address: undefined, chain: undefined };
const mockDistribution = jest.fn();

jest.mock("../../hooks/useAddLiquidity", () => ({
  useAddLiquidity: () => ({ ...mockHook, add: mockAdd, reload: mockReload, chainName: "Polygon", clearResult: jest.fn() }),
}));
jest.mock("../../hooks/useLiquidityDistribution", () => ({ useLiquidityDistribution: (options: unknown) => mockDistribution(options) }));
jest.mock("wagmi", () => ({ useAccount: () => mockAccount }));
jest.mock("../../redux/slices/marketRateSlice", () => ({
  useGetMarketRateQuery: () => ({ data: { WETH: { USD: "3000" }, TEL: { USD: "0.005" } } }),
}));
jest.mock("../pool/PoolWeightChip", () => ({ getAssetImage: () => null }));
jest.mock("../layout/CustomConnectButton", () => ({ CustomConnectButton: () => <button type="button">Connect wallet</button> }));

const TICK = 0;
function pool(currency0: string = WETH): PoolReadState {
  return {
    poolKey: { currency0: currency0 as `0x${string}`, currency1: TEL, fee: 3000, tickSpacing: 60, hooks: zeroAddress },
    sqrtPriceX96: getSqrtPriceAtTick(TICK),
    tick: TICK,
    poolLiquidity: 10n ** 21n,
    decimals: [18, 18],
  };
}
const RICH = 10n ** 24n;
const ASSETS: [{ ticker: string; address: string }, { ticker: string; address: string }] = [
  { ticker: "WETH", address: WETH },
  { ticker: "TEL", address: TEL },
];
const ETH_ASSETS: typeof ASSETS = [
  { ticker: "ETH", address: zeroAddress },
  { ticker: "TEL", address: TEL },
];

beforeEach(() => {
  mockAdd.mockReset();
  mockReload.mockReset();
  mockDistribution.mockReset().mockReturnValue([{ tickLower: -7_000, tickUpper: 7_000, liquidity: 10n ** 21n }]);
  mockAccount.address = "0x00000000000000000000000000000000000000aa";
  mockAccount.chain = { id: 137 };
  Object.assign(mockHook, { pool: pool(), wallet: { balances: [RICH, RICH], approvals: [APPROVED, APPROVED] }, loadError: false, pending: null, result: null });
});

const panel = (assets = ASSETS, blockchain = "polygon") => <AddLiquidityPanel blockchain={blockchain} poolId={MERKL_POLYGON_WETH_TEL_POOLID} assets={assets} />;
const renderPanel = (assets = ASSETS, blockchain = "polygon") => render(panel(assets, blockchain));
const amount = (symbol: string) => screen.getByRole("textbox", { name: symbol }) as HTMLInputElement;
const priceInput = (name: "Min price" | "Max price") => screen.getByRole("textbox", { name }) as HTMLInputElement;
const mainButton = () => screen.getByRole("button", { name: /^(Approve|Add liquidity)/ });
/** The range the panel would send, read from the add it sends. */
function sentRange(): TickRange {
  fireEvent.change(amount("WETH"), { target: { value: "1" } });
  fireEvent.click(mainButton());
  const { tickLower, tickUpper } = mockAdd.mock.calls.at(-1)[0];
  return { tickLower, tickUpper };
}

describe("AddLiquidityPanel", () => {
  it("shows a loader until the pool is read, and a retry when the read fails", () => {
    mockHook.pool = null;
    const { rerender } = renderPanel();
    expect(screen.getByText(/Reading the pool/)).toBeInTheDocument();

    mockHook.loadError = true;
    rerender(panel());
    expect(screen.getByRole("alert")).toHaveTextContent("The pool could not be read from Polygon.");
    fireEvent.click(screen.getByRole("button", { name: "Read the pool again" }));
    expect(mockReload).toHaveBeenCalled();
  });

  it("names the pair, its fee tier and chain, and that it earns TELx rewards", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Add liquidity: WETH / TEL" })).toBeInTheDocument();
    expect(screen.getByText("0.3% fee tier on Polygon")).toBeInTheDocument();
    expect(screen.getByText("Earns TELx rewards")).toBeInTheDocument();
  });

  it("draws the pool's liquidity around the range, and refits the chart to a new range", () => {
    renderPanel();
    const fullWindow = mockDistribution.mock.calls.at(-1)[0].window;
    expect(mockDistribution).toHaveBeenLastCalledWith(expect.objectContaining({ chainId: 137, poolId: MERKL_POLYGON_WETH_TEL_POOLID, tickSpacing: 60, currentTick: TICK }));
    fireEvent.click(screen.getByRole("button", { name: "±10%" }));
    const narrowWindow = mockDistribution.mock.calls.at(-1)[0].window;
    expect(narrowWindow.tickUpper - narrowWindow.tickLower).toBeLessThan(fullWindow.tickUpper - fullWindow.tickLower);
  });

  it("shows full range as 0 to infinity, with no handles and the price boxes locked", () => {
    renderPanel();
    expect(priceInput("Min price").value).toBe("0");
    expect(priceInput("Max price").value).toBe("∞");
    expect(priceInput("Min price")).toBeDisabled();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("derives the other amount from the one typed, and previews the deposit with USD values", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "±10%" }));
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    // At a price of 1, a 10% band takes about 1.1 TEL per WETH: the upper half of the band is narrower in sqrt price.
    expect(Number(amount("TEL").value)).toBeCloseTo(1.12, 1);
    expect(screen.getByText("$3,000.00")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Preview")).getByText("Subscribed on creation")).toBeInTheDocument();
    expect(mainButton()).toHaveTextContent("Add liquidity and subscribe");
    expect(mainButton()).toBeEnabled();
  });

  it("keeps the typed amount and recomputes the other one when the range changes", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "±10%" }));
    fireEvent.change(amount("TEL"), { target: { value: "2" } });
    const narrow = amount("WETH").value;
    fireEvent.click(screen.getByRole("button", { name: "Full range" }));
    expect(amount("TEL").value).toBe("2");
    expect(amount("WETH").value).not.toBe(narrow);
  });

  it("sends the planned add with the range, liquidity and slippage maxima", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "±25%" }));
    fireEvent.click(screen.getByRole("button", { name: "1%" }));
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    fireEvent.click(mainButton());
    const request = mockAdd.mock.calls[0][0];
    expect({ tickLower: request.tickLower, tickUpper: request.tickUpper }).toEqual(presetRange("25", TICK, 60));
    expect(request.liquidity).toBeGreaterThan(0n);
    // 1% slippage on about 1 WETH.
    expect(request.amount0Max).toBeGreaterThanOrEqual(10n ** 18n);
    expect(request.amount0Max).toBeLessThanOrEqual(1_011n * 10n ** 15n);
  });

  it("steps a price box by one tick spacing, making the range custom", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "±25%" }));
    const preset = presetRange("25", TICK, 60);
    fireEvent.click(screen.getByRole("button", { name: "Raise the max price" }));
    fireEvent.click(screen.getByRole("button", { name: "Lower the min price" }));
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(sentRange()).toEqual({ tickLower: preset.tickLower - 60, tickUpper: preset.tickUpper + 60 });
  });

  it("moves a range handle with the arrow keys, one tick spacing at a time", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "±25%" }));
    const preset = presetRange("25", TICK, 60);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Max price" }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Max price" }), { key: "PageUp" });
    expect(sentRange()).toEqual({ tickLower: preset.tickLower, tickUpper: preset.tickUpper + 11 * 60 });
  });

  it("takes a typed price, aligned to the tick spacing", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(priceInput("Max price"), { target: { value: "1.5" } });
    fireEvent.blur(priceInput("Max price"));
    const range = sentRange();
    expect(Math.abs(range.tickUpper % 60)).toBe(0);
    expect(priceAtTick(range.tickUpper, 18, 18)).toBeGreaterThanOrEqual(1.5);
    expect(priceAtTick(range.tickUpper - 60, 18, 18)).toBeLessThan(1.5);
  });

  it("lists what one click will ask for, and runs it all from the one button", () => {
    mockHook.wallet = { balances: [RICH, RICH], approvals: [UNAPPROVED, { ...APPROVED, permit2Expiration: 1 }] };
    renderPanel();
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    const steps = within(screen.getByRole("list", { name: "Steps, all from one click" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(steps).toEqual(["1. Approve WETH (once)", "2. Sign the token allowance (no gas)", "3. Add liquidity and subscribe"]);
    expect(mainButton()).toHaveTextContent("Add liquidity and subscribe");
    fireEvent.click(mainButton());
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0]).toEqual(expect.objectContaining({ symbols: ["WETH", "TEL"] }));
  });

  it("marks the step in progress and the ones done", () => {
    mockHook.wallet = { balances: [RICH, RICH], approvals: [UNAPPROVED, UNAPPROVED] };
    mockHook.pending = { task: { kind: "permit" }, step: "signing", chainName: "Polygon" };
    renderPanel();
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    const items = within(screen.getByRole("list", { name: "Steps, all from one click" })).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("aria-current"))).toEqual([null, null, "step", null]);
    expect(items[0]).toHaveClass("line-through");
  });

  it("needs only the add when both tokens are already allowed", () => {
    renderPanel();
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    expect(screen.queryByRole("list", { name: "Steps, all from one click" })).not.toBeInTheDocument();
  });

  it("needs no approval for native ETH", () => {
    mockHook.pool = pool(zeroAddress);
    mockHook.wallet = { balances: [RICH, RICH], approvals: [UNAPPROVED, APPROVED] };
    renderPanel(ETH_ASSETS, "base");
    fireEvent.change(amount("ETH"), { target: { value: "1" } });
    expect(mainButton()).toHaveTextContent("Add liquidity and subscribe");
  });

  it("blocks a custom range narrower than 5% each side, or one that misses the current price", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(priceInput("Min price"), { target: { value: "0.98" } });
    fireEvent.blur(priceInput("Min price"));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 5% below and above/);
    expect(amount("WETH")).toBeDisabled();

    fireEvent.change(priceInput("Min price"), { target: { value: "1.05" } });
    fireEvent.blur(priceInput("Min price"));
    expect(screen.getByRole("alert")).toHaveTextContent(/include the current price/);
    expect(mainButton()).toBeDisabled();
  });

  it("starts a custom range at about plus or minus 10% from full range, which is allowed", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(Number(priceInput("Min price").value)).toBeCloseTo(0.9, 1);
    expect(Number(priceInput("Max price").value)).toBeCloseTo(1.1, 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flags an amount above the balance and disables the add", () => {
    mockHook.wallet = { balances: [10n ** 17n, RICH], approvals: [APPROVED, APPROVED] };
    renderPanel();
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    expect(screen.getByText(/not enough WETH/)).toBeInTheDocument();
    expect(mainButton()).toBeDisabled();
  });

  it("fills MAX with the balance less room for slippage, and keeps gas back for native ETH", () => {
    mockHook.pool = pool(zeroAddress);
    mockHook.wallet = { balances: [10n ** 18n, RICH], approvals: [UNAPPROVED, APPROVED] };
    renderPanel(ETH_ASSETS, "base");
    fireEvent.click(screen.getAllByRole("button", { name: "MAX" })[0]);
    // (1 ETH - 0.001 ETH for gas) / 1.005
    expect(amount("ETH").value).toBe("0.994029850746268656");
    expect(mainButton()).toBeEnabled();
  });

  it("offers to connect a wallet in place of the steps when none is connected", () => {
    mockAccount.address = undefined;
    mockAccount.chain = undefined;
    mockHook.wallet = null;
    renderPanel();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add liquidity/ })).not.toBeInTheDocument();
    // The range and chart still show, so a visitor can explore before connecting.
    expect(screen.getByRole("button", { name: "±10%" })).toBeInTheDocument();
  });

  it("shows the wallet step, then the explorer link while mining", () => {
    mockAccount.chain = { id: 1 };
    const { rerender } = renderPanel();
    expect(screen.getByText("Your wallet will be asked to switch to Polygon first.")).toBeInTheDocument();

    mockHook.pending = { task: { kind: "add" }, step: "signing", chainName: "Polygon" };
    rerender(panel());
    expect(screen.getByRole("status")).toHaveTextContent("Confirm in your wallet: add liquidity and subscribe on Polygon.");

    mockHook.pending = { task: { kind: "add" }, step: "mining", chainName: "Polygon", txUrl: "https://polygonscan.com/tx/0xff", txLinkLabel: "View on Polygonscan" };
    rerender(panel());
    expect(screen.getByRole("link", { name: "View on Polygonscan" })).toHaveAttribute("href", "https://polygonscan.com/tx/0xff");
    expect(mainButton()).toBeDisabled();
  });

  it("links each token to the swap page, set to buy it on the pool's chain", () => {
    mockHook.pool = pool(zeroAddress);
    renderPanel(ETH_ASSETS, "base");
    expect(screen.getByRole("link", { name: "Buy ETH" })).toHaveAttribute("href", "/swap?chain=base&buy=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
    expect(screen.getByRole("link", { name: "Buy TEL" })).toHaveAttribute("href", `/swap?chain=base&buy=${TEL}`);
  });

  it("shows the outcome of the last transaction", () => {
    mockHook.result = { kind: "success", message: "Position #9 added and subscribed to TELx rewards.", txUrl: "https://polygonscan.com/tx/0xff", txLinkLabel: "View on Polygonscan" };
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent("Position #9 added and subscribed to TELx rewards.");
  });
});
