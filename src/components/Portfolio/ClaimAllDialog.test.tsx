import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClaimAllDialog, { statusText } from "./ClaimAllDialog";
import { buildClaimPlan, claimRowInputs } from "@/lib/claims/claimPlan";
import type { ClaimAll } from "@/hooks/useClaimAll";

jest.mock("../common/ChainLogo", () => function ChainLogo() {
  return null;
});

const HASH = `0x${"ab".repeat(32)}`;
const rows = buildClaimPlan(claimRowInputs({ polygon: 200_000, ethereum: 100 }, { base: 50 }), {
  currentChainId: 137,
  telUsd: 0.002,
  feesUsd: { "merkl:polygon": 0.01, "merkl:ethereum": 2.5 },
});

function claimAll(overrides: Partial<ClaimAll> = {}): ClaimAll {
  return {
    label: "Claim all (3 chains)",
    disabledReason: null,
    phase: "review",
    rows,
    statuses: {},
    result: null,
    open: jest.fn(),
    toggle: jest.fn(),
    start: jest.fn(),
    decide: jest.fn(),
    close: jest.fn(),
    ...overrides,
  };
}

describe("ClaimAllDialog", () => {
  it("renders nothing while closed", () => {
    render(<ClaimAllDialog claimAll={claimAll({ phase: "closed" })} />);
    expect(screen.queryByRole("heading", { name: "Claim your TEL" })).not.toBeInTheDocument();
  });

  it("lists each claim with its amount, fee and notes, and claims the checked ones", async () => {
    const user = userEvent.setup();
    const props = claimAll();
    render(<ClaimAllDialog claimAll={props} />);

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).toHaveAttribute("aria-labelledby", "claim-all-title");
    const items = within(dialog).getAllByRole("listitem", { hidden: true });
    expect(items.map((item) => within(item).getAllByText(/Polygon|Ethereum|Base/)[0].textContent)).toEqual(["Polygon", "Ethereum", "Base"]);
    expect(items[0]).toHaveTextContent("Network fee about $0.01");
    expect(items[1]).toHaveTextContent("Costs more in fees than it's worth, so it starts unchecked.");
    expect(within(items[1]).getByRole("checkbox", { hidden: true })).not.toBeChecked();
    expect(items[2]).toHaveTextContent("legacy TEL");
    expect(items[2]).toHaveTextContent("Network fee unknown");
    expect(within(items[2]).getByRole("link", { name: "official upgrade site", hidden: true })).toHaveAttribute("href", "https://tel3.telcoin.network/upgrade");

    await user.click(within(items[1]).getByRole("checkbox", { hidden: true }));
    expect(props.toggle).toHaveBeenCalledWith("merkl:ethereum");

    await user.click(screen.getByRole("button", { name: "Claim 2", hidden: true }));
    expect(props.start).toHaveBeenCalled();
  });

  it("shows each claim's progress and announces the latest step", () => {
    render(
      <ClaimAllDialog
        claimAll={claimAll({
          phase: "running",
          statuses: { "merkl:polygon": { state: "claimed", hash: HASH as `0x${string}`, amountTel: 200_000 }, "oldPools:base": { state: "switching" } },
        })}
      />
    );
    expect(screen.getByText(/^Claimed 200,000 TEL on Polygon/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction", hidden: true })).toHaveAttribute("href", `https://polygonscan.com/tx/${HASH}`);
    expect(screen.getAllByText("Approve the switch to Base in your wallet")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Stop after this claim", hidden: true })).toBeInTheDocument();
  });

  it("offers try again, skip and stop when a claim fails", async () => {
    const user = userEvent.setup();
    const props = claimAll({ phase: "paused", statuses: { "merkl:polygon": { state: "failed", reason: "The claim was rejected in the wallet." } } });
    render(<ClaimAllDialog claimAll={props} />);

    expect(screen.getAllByText("The claim was rejected in the wallet.").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Try again", hidden: true }));
    await user.click(screen.getByRole("button", { name: "Skip", hidden: true }));
    await user.click(screen.getByRole("button", { name: "Stop", hidden: true }));
    expect((props.decide as jest.Mock).mock.calls).toEqual([["retry"], ["skip"], ["stop"]]);
  });

  it("sums up what was claimed across chains", () => {
    const [polygon, , base] = rows;
    render(
      <ClaimAllDialog
        claimAll={claimAll({
          phase: "done",
          result: {
            stopped: false,
            claimed: [
              { row: polygon, amountTel: 200_000, hash: HASH as `0x${string}` },
              { row: base, amountTel: 50, hash: HASH as `0x${string}` },
            ],
          },
        })}
      />
    );
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Claimed 200,000 TEL and 50 legacy TEL on 2 chains.");
  });

  it("says at the wallet prompt when the amount changed since the plan was built", () => {
    const polygon = rows.find((row) => row.id === "merkl:polygon")!;
    expect(statusText(polygon, { state: "confirm", amountTel: 200_000 })).toBe("Confirm the claim on Polygon in your wallet");
    expect(statusText(polygon, { state: "confirm", amountTel: 250_000 })).toMatch(
      /^Confirm the claim of 250,000 TEL on Polygon in your wallet \(updated from 200,000 TEL\)$/
    );
  });

  it("closes on Escape", () => {
    const props = claimAll();
    render(<ClaimAllDialog claimAll={props} />);
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));
    expect(props.close).toHaveBeenCalled();
  });
});

describe("ClaimAllDialog fees rows", () => {
  const TARGETS = [{ tokenId: "144097", poolId: "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d" as const, tickLower: 136620, tickUpper: 150480 }];
  const feesRows = buildClaimPlan(
    claimRowInputs({ polygon: 200_000 }, {}, { polygon: { targets: TARGETS, summary: "0.001 WETH · 5 TEL", valueUsd: 3.03 } }),
    { currentChainId: 137, telUsd: 0.002, feesUsd: { "merkl:polygon": 0.01, "fees:polygon": 0.01 } }
  );
  const fees = feesRows.find((row) => row.id === "fees:polygon")!;

  it("lists a chain's trading fees as their own row, to collect", () => {
    render(<ClaimAllDialog claimAll={claimAll({ rows: feesRows })} />);
    expect(screen.getByRole("checkbox", { name: "Collect 0.001 WETH · 5 TEL on Polygon" })).toBeChecked();
    const item = screen.getAllByRole("listitem").find((li) => within(li).queryByText("Trading fees (Uniswap)"))!;
    expect(within(item).getByText("0.001 WETH · 5 TEL")).toBeInTheDocument();
    expect(within(item).getByText("$3.03")).toBeInTheDocument();
  });

  it("words each step as a collect, with what it collected", () => {
    expect(statusText(fees, { state: "preparing" })).toBe("Checking the fees owed now on Polygon");
    expect(statusText(fees, { state: "confirm", amountTel: 0, summary: "0.0012 WETH and 5.1 TEL" })).toBe("Confirm collecting 0.0012 WETH and 5.1 TEL on Polygon in your wallet");
    expect(statusText(fees, { state: "claimed", hash: HASH as `0x${string}`, amountTel: 0, summary: "0.0012 WETH and 5.1 TEL" })).toBe("Collected 0.0012 WETH and 5.1 TEL on Polygon");
  });

  it("sums claims and collects separately when the run finishes", () => {
    const merkl = feesRows.find((row) => row.id === "merkl:polygon")!;
    render(
      <ClaimAllDialog
        claimAll={claimAll({
          rows: feesRows,
          phase: "done",
          result: {
            stopped: false,
            claimed: [
              { row: merkl, amountTel: 200_000, hash: HASH as `0x${string}` },
              { row: fees, amountTel: 0, hash: HASH as `0x${string}`, summary: "0.001 WETH and 5 TEL" },
            ],
          },
        })}
      />
    );
    expect(screen.getByText("Claimed 200,000 TEL on 1 chain. Collected trading fees on 1 chain.")).toBeInTheDocument();
  });
});
