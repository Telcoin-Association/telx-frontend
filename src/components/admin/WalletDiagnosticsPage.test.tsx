import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminWalletReport } from "@/lib/adminWallet";
import WalletDiagnosticsPage, { formatDuration } from "./WalletDiagnosticsPage";

const ADDRESS = "0x00000000000000000000000000000000000000aa";

const report: AdminWalletReport = {
  address: ADDRESS,
  generatedAt: 2_000_000_000,
  flags: [{ kind: "subscribed-out-of-range", chain: "polygon", tokenId: "1", message: "#1 (WETH/TEL) is subscribed but out of range." }],
  chains: [
    {
      chain: "polygon",
      head: { block: 100, timestamp: 2_000_000_000 },
      inRangeRequired: true,
      merkl: [{ symbol: "TEL", amount: "10", claimed: "4", claimable: "6", pending: "1", claimableUSD: 0.03 }],
      oldPoolsClaimable: "0",
      notes: [],
      errors: [],
      positions: [
        {
          chain: "polygon",
          tokenId: "1",
          poolId: "0xpool",
          poolName: "WETH/TEL polygon merkl",
          merklPool: true,
          status: "open",
          tickLower: -100,
          tickUpper: 100,
          liquidity: "1000",
          amounts: { amount0: "1.5", amount1: "2000", symbol0: "WETH", symbol1: "TEL" },
          currentTick: 500,
          inRangeNow: false,
          subscribed: true,
          registry: { isInRange: false, belowThreshold: false, eligible: true },
          subscriptions: [{ kind: "subscribed", t: 1_999_990_000, block: 90, txHash: "0xabc", how: null }],
          range: {
            from: 1_999_990_000,
            to: 2_000_000_000,
            activeSeconds: 10_000,
            inRangeSeconds: 6_400,
            outOfRangeSeconds: 3_600,
            unknownSeconds: 0,
            subscribedSeconds: 10_000,
            subscribedOutOfRangeSeconds: 3_600,
            spans: [
              { from: 1_999_990_000, to: 1_999_996_400, inRange: true, subscribed: true },
              { from: 1_999_996_400, to: 2_000_000_000, inRange: false, subscribed: true },
            ],
            spansTruncated: false,
          },
          positionUrl: "https://polygonscan.com/nft/0xpm/1",
        },
      ],
    },
    { chain: "base", head: null, inRangeRequired: null, merkl: null, positions: [], notes: [], errors: ["Chain read failed: node down"] },
  ],
};

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  window.history.replaceState(null, "", "/admin/wallet");
});

const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe("WalletDiagnosticsPage", () => {
  it("refuses an invalid address without calling the API", async () => {
    render(<WalletDiagnosticsPage />);
    await userEvent.type(screen.getByLabelText("Wallet address"), "0x123");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("valid wallet address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the flags, rewards, range times and subscription history for a wallet", async () => {
    respond(report);
    render(<WalletDiagnosticsPage />);
    await userEvent.type(screen.getByLabelText("Wallet address"), ADDRESS);
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(fetchMock).toHaveBeenCalledWith(`/api/wallet-diagnostics?address=${ADDRESS}`, { cache: "no-store" });
    expect(await screen.findByTestId("diagnostics-flag")).toHaveTextContent("subscribed but out of range");

    const polygon = screen.getByRole("region", { name: "Polygon" });
    expect(within(polygon).getByText(/6 TEL claimable, 1 pending, 4 claimed/)).toBeInTheDocument();
    const card = within(polygon).getByTestId("diagnostics-position");
    expect(card).toHaveTextContent("#1");
    expect(card).toHaveTextContent("out of range 1h 0m (36%)");
    expect(card).toHaveTextContent("Subscribed 2h 47m, of which out of range 1h 0m (36%)");
    expect(within(card).getByRole("img")).toHaveAccessibleName("In range 64% of the time with liquidity");
    expect(within(card).getByRole("link", { name: "transaction" })).toHaveAttribute("href", "https://polygonscan.com/tx/0xabc");

    const base = screen.getByRole("region", { name: "Base" });
    expect(within(base).getByText("Chain read failed: node down")).toBeInTheDocument();
    expect(window.location.search).toBe(`?address=${ADDRESS}`);
  });

  it("loads the wallet named in the link", async () => {
    respond(report);
    window.history.replaceState(null, "", `/admin/wallet?address=${ADDRESS}`);
    render(<WalletDiagnosticsPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Wallet address")).toHaveValue(ADDRESS);
  });

  it("shows the API's error", async () => {
    respond({ error: "Too many requests. Try again in a minute." }, 429);
    render(<WalletDiagnosticsPage />);
    await userEvent.type(screen.getByLabelText("Wallet address"), ADDRESS);
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
  });
});

describe("formatDuration", () => {
  it("reads in the largest sensible units", () => {
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(3 * 3600 + 120)).toBe("3h 2m");
    expect(formatDuration(3 * 86400 + 5 * 3600)).toBe("3d 5h");
  });
});
