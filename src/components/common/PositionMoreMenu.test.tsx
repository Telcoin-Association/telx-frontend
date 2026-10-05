import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PositionMoreMenu, { placeMenu } from "./PositionMoreMenu";

const rect = (top: number, right: number, height = 40, width = 40) =>
  ({ top, bottom: top + height, right, left: right - width, width, height, x: right - width, y: top, toJSON: () => ({}) }) as DOMRect;

const VIEWPORT = { width: 1280, height: 800 };
const MENU = { width: 176, height: 130 };

describe("placeMenu", () => {
  it("opens below the button with right edges aligned when there is room", () => {
    expect(placeMenu(rect(100, 1000), MENU, VIEWPORT)).toEqual({ top: 148, left: 824, above: false });
  });

  it("opens above the button when the space below is too short", () => {
    expect(placeMenu(rect(700, 1000), MENU, VIEWPORT)).toEqual({ top: 562, left: 824, above: true });
  });

  it("stays below when neither side fits but below has more room", () => {
    expect(placeMenu(rect(60, 1000), MENU, { width: 1280, height: 230 })).toMatchObject({ above: false, top: 108 });
  });

  it("keeps the menu inside the viewport horizontally", () => {
    expect(placeMenu(rect(100, 100), MENU, VIEWPORT).left).toBe(8);
    expect(placeMenu(rect(100, 1300), MENU, VIEWPORT).left).toBe(1280 - 176 - 8);
  });
});

describe("PositionMoreMenu", () => {
  const renderInClippedRow = (onUnsubscribe = jest.fn()) =>
    render(
      <ul data-testid="list" style={{ overflow: "hidden" }}>
        <li data-testid="row">
          <PositionMoreMenu
            label="More actions for position 7"
            items={[
              { key: "history", label: "Show history", onSelect: jest.fn() },
              { key: "unsubscribe", label: "Unsubscribe…", onSelect: onUnsubscribe, tone: "danger" },
            ]}
          />
        </li>
      </ul>,
    );

  it("renders the open menu outside the row, so a clipping list can't cut it off", async () => {
    const user = userEvent.setup();
    renderInClippedRow();
    await user.click(screen.getByRole("button", { name: "More actions for position 7" }));

    const menu = screen.getByRole("menu", { name: "More actions for position 7" });
    expect(screen.getByTestId("list")).not.toContainElement(menu);
    expect(menu).toHaveStyle({ position: "fixed" });
    expect(screen.getByRole("menuitem", { name: "Show history" })).toHaveFocus();
  });

  it("runs an item chosen in the menu, and returns focus to the button", async () => {
    const user = userEvent.setup();
    const onUnsubscribe = jest.fn();
    renderInClippedRow(onUnsubscribe);
    await user.click(screen.getByRole("button", { name: "More actions for position 7" }));
    await user.click(screen.getByRole("menuitem", { name: "Unsubscribe…" }));

    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions for position 7" })).toHaveFocus();
  });

  it("closes on Escape, on Tab and on a click outside", async () => {
    const user = userEvent.setup();
    renderInClippedRow();
    const button = screen.getByRole("button", { name: "More actions for position 7" });

    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await user.click(button);
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
