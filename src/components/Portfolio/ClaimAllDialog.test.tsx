import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClaimAllDialog from "./ClaimAllDialog";
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

  it("closes on Escape", () => {
    const props = claimAll();
    render(<ClaimAllDialog claimAll={props} />);
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("cancel", { cancelable: true }));
    expect(props.close).toHaveBeenCalled();
  });
});
