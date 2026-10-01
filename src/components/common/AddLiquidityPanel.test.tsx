import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { zeroAddress } from "viem";
import AddLiquidityPanel from "./AddLiquidityPanel";
import { MERKL_POLYGON_WETH_TEL_POOLID } from "../../lib/contracts";
import { getSqrtPriceAtTick } from "../../lib/v4/liquidityMath";
import type { PoolReadState, WalletReadState, AddLiquidityPending, AddLiquidityResult } from "../../hooks/useAddLiquidity";

const WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const TEL = "0x7E13B43065380aCdeC1c2d138c579cbBbafA0731";
const FAR_FUTURE = 4_000_000_000;
const APPROVED = { erc20ToPermit2: 2n ** 255n, permit2Amount: 2n ** 159n, permit2Expiration: FAR_FUTURE };
const UNAPPROVED = { erc20ToPermit2: 0n, permit2Amount: 0n, permit2Expiration: 0 };

const mockApprove = jest.fn();
const mockAdd = jest.fn();
const mockReload = jest.fn();
const mockHook: {
  pool: PoolReadState | null;
  wallet: WalletReadState | null;
  loadError: boolean;
  pending: AddLiquidityPending | null;
  result: AddLiquidityResult | null;
} = { pool: null, wallet: null, loadError: false, pending: null, result: null };
const mockChain: { id: number } = { id: 137 };

jest.mock("../../hooks/useAddLiquidity", () => ({
  useAddLiquidity: () => ({ ...mockHook, approve: mockApprove, add: mockAdd, reload: mockReload, chainName: "Polygon", clearResult: jest.fn() }),
}));
jest.mock("wagmi", () => ({ useAccount: () => ({ chain: mockChain }) }));

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

beforeEach(() => {
  mockApprove.mockReset();
  mockAdd.mockReset();
  mockReload.mockReset();
  mockChain.id = 137;
  Object.assign(mockHook, { pool: pool(), wallet: { balances: [RICH, RICH], approvals: [APPROVED, APPROVED] }, loadError: false, pending: null, result: null });
});

const renderPanel = () => render(<AddLiquidityPanel blockchain="polygon" poolId={MERKL_POLYGON_WETH_TEL_POOLID} symbols={["WETH", "TEL"]} />);
const amount = (symbol: string) => screen.getByLabelText(symbol) as HTMLInputElement;
const mainButton = () => screen.getByRole("button", { name: /^(Approve|Add liquidity)/ });

describe("AddLiquidityPanel", () => {
  it("shows a loader until the pool is read, and a retry when the read fails", () => {
    mockHook.pool = null;
    const { rerender } = renderPanel();
    expect(screen.getByText(/Reading the pool/)).toBeInTheDocument();

    mockHook.loadError = true;
    rerender(<AddLiquidityPanel blockchain="polygon" poolId={MERKL_POLYGON_WETH_TEL_POOLID} symbols={["WETH", "TEL"]} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/The pool could not be read from Polygon\./);
    fireEvent.click(screen.getByRole("button", { name: "Read the pool again" }));
    expect(mockReload).toHaveBeenCalled();
  });

  it("derives the other amount from the one typed, and previews the deposit", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "±10%" }));
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    // At a price of 1, a 10% band takes about 1.1 TEL per WETH: the upper half of the band is narrower in sqrt price.
    expect(Number(amount("TEL").value)).toBeCloseTo(1.12, 1);
    expect(within(screen.getByLabelText("Preview")).getByText("Subscribed on creation")).toBeInTheDocument();
    expect(mainButton()).toHaveTextContent(/Add liquidity and subscribe/);
    expect((mainButton() as HTMLButtonElement).disabled).toBe(false);
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
    expect(Math.abs(request.tickLower % 60)).toBe(0);
    expect(Math.abs(request.tickUpper % 60)).toBe(0);
    expect(request.tickLower).toBeLessThan(TICK);
    expect(request.tickUpper).toBeGreaterThan(TICK);
    expect(request.liquidity).toBeGreaterThan(0n);
    // 1% slippage on about 1 WETH.
    expect(request.amount0Max).toBeGreaterThanOrEqual(10n ** 18n);
    expect(request.amount0Max).toBeLessThanOrEqual(1_011n * 10n ** 15n);
  });

  it("asks for each token's approvals in order before the add", () => {
    mockHook.wallet = { balances: [RICH, RICH], approvals: [UNAPPROVED, { ...APPROVED, permit2Expiration: 1 }] };
    renderPanel();
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(["1. Approve WETH", "2. Approve WETH (Permit2)", "3. Approve TEL (Permit2)", "4. Add liquidity and subscribe"]);
    fireEvent.click(mainButton());
    expect(mockApprove).toHaveBeenCalledWith({ kind: "erc20", currency: WETH, symbol: "WETH" });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("needs no approval for native ETH", () => {
    mockHook.pool = pool(zeroAddress);
    mockHook.wallet = { balances: [RICH, RICH], approvals: [UNAPPROVED, APPROVED] };
    render(<AddLiquidityPanel blockchain="base" poolId={MERKL_POLYGON_WETH_TEL_POOLID} symbols={["ETH", "TEL"]} />);
    fireEvent.change(amount("ETH"), { target: { value: "1" } });
    expect(mainButton()).toHaveTextContent(/Add liquidity and subscribe/);
  });

  it("blocks a custom range narrower than 5% each side, or one that misses the current price", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText(/Min price/), { target: { value: "0.98" } });
    fireEvent.change(screen.getByLabelText(/Max price/), { target: { value: "1.2" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 5% below and above/);
    expect((amount("WETH") as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Min price/), { target: { value: "1.1" } });
    fireEvent.change(screen.getByLabelText(/Max price/), { target: { value: "1.5" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/include the current price/);
    expect((mainButton() as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
  });

  it("starts a custom range at about plus or minus 10%, which is allowed", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(Number((screen.getByLabelText(/Min price/) as HTMLInputElement).value)).toBeCloseTo(0.9, 1);
    expect(Number((screen.getByLabelText(/Max price/) as HTMLInputElement).value)).toBeCloseTo(1.1, 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flags an amount above the balance and disables the add", () => {
    mockHook.wallet = { balances: [10n ** 17n, RICH], approvals: [APPROVED, APPROVED] };
    renderPanel();
    fireEvent.change(amount("WETH"), { target: { value: "1" } });
    expect(screen.getByText(/not enough WETH/)).toBeInTheDocument();
    expect((mainButton() as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
  });

  it("fills MAX with the balance less room for slippage, and keeps gas back for native ETH", () => {
    mockHook.pool = pool(zeroAddress);
    mockHook.wallet = { balances: [10n ** 18n, RICH], approvals: [UNAPPROVED, APPROVED] };
    render(<AddLiquidityPanel blockchain="base" poolId={MERKL_POLYGON_WETH_TEL_POOLID} symbols={["ETH", "TEL"]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "MAX" })[0]);
    // (1 ETH - 0.001 ETH for gas) / 1.005
    expect(amount("ETH").value).toBe("0.994029850746268656");
    expect((mainButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the wallet step, then the explorer link while mining", () => {
    mockChain.id = 1;
    const { rerender } = renderPanel();
    expect(screen.getByText("Your wallet will be asked to switch to Polygon first.")).toBeInTheDocument();

    mockHook.pending = { task: { kind: "add" }, step: "signing", chainName: "Polygon" };
    rerender(<AddLiquidityPanel blockchain="polygon" poolId={MERKL_POLYGON_WETH_TEL_POOLID} symbols={["WETH", "TEL"]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Confirm in your wallet: add liquidity and subscribe on Polygon\./);

    mockHook.pending = { task: { kind: "add" }, step: "mining", chainName: "Polygon", txUrl: "https://polygonscan.com/tx/0xff", txLinkLabel: "View on Polygonscan" };
    rerender(<AddLiquidityPanel blockchain="polygon" poolId={MERKL_POLYGON_WETH_TEL_POOLID} symbols={["WETH", "TEL"]} />);
    expect(screen.getByRole("link", { name: "View on Polygonscan" })).toHaveAttribute("href", "https://polygonscan.com/tx/0xff");
    expect((mainButton() as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
  });

  it("links each token to the swap page, set to buy it on the pool's chain", () => {
    mockHook.pool = pool(zeroAddress);
    render(<AddLiquidityPanel blockchain="base" poolId={MERKL_POLYGON_WETH_TEL_POOLID} symbols={["ETH", "TEL"]} />);
    expect(screen.getByRole("link", { name: "Buy ETH" })).toHaveAttribute("href", "/swap?chain=base&buy=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
    expect(screen.getByRole("link", { name: "Buy TEL" })).toHaveAttribute("href", `/swap?chain=base&buy=${TEL}`);
  });

  it("shows the outcome of the last transaction", () => {
    mockHook.result = { kind: "success", message: "Position #9 added and subscribed to TELx rewards.", txUrl: "https://polygonscan.com/tx/0xff", txLinkLabel: "View on Polygonscan" };
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/Position #9 added and subscribed to TELx rewards\./);
  });
});
