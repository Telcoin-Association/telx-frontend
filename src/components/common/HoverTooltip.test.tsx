import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import HoverTooltip, { tooltipPosition } from "./HoverTooltip";
import LabelValueRow from "./LabelValueRow";

const NOTE = "Partial total: excludes Polygon pools, whose data is unavailable";

function renderTip(label = "TVL: partial total") {
  return render(
    <div>
      <HoverTooltip content={NOTE} label={label}>
        partial
      </HoverTooltip>
      <p>outside</p>
    </div>,
  );
}

const tip = () => screen.getByRole("tooltip", { hidden: true });

describe("tooltipPosition", () => {
  const viewport = { width: 320, height: 640 };
  const size = { width: 160, height: 40 };

  it("places the tip below the trigger, shifted left to stay inside a narrow viewport", () => {
    const trigger = { top: 100, bottom: 120, left: 250, right: 290 };
    expect(tooltipPosition(trigger, size, viewport, "below")).toEqual({ top: 126, left: 320 - 160 - 8 });
  });

  it("flips to the other side when the preferred one does not fit", () => {
    const nearBottom = { top: 610, bottom: 630, left: 10, right: 50 };
    expect(tooltipPosition(nearBottom, size, viewport, "below").top).toBe(610 - 6 - 40);
    const nearTop = { top: 10, bottom: 30, left: 10, right: 50 };
    expect(tooltipPosition(nearTop, size, viewport, "above").top).toBe(36);
  });

  it("falls back from left to below when there is no room on the left", () => {
    const trigger = { top: 100, bottom: 120, left: 40, right: 80 };
    expect(tooltipPosition(trigger, size, viewport, "left")).toEqual({ top: 126, left: 40 });
  });

  it("never places the tip past the viewport's left edge, even when it is wider than the viewport", () => {
    const trigger = { top: 100, bottom: 120, left: 0, right: 20 };
    expect(tooltipPosition(trigger, { width: 400, height: 40 }, viewport, "below").left).toBe(8);
  });
});

describe("HoverTooltip", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("is a button named by its label and described by the tip, which lives outside the trigger", () => {
    renderTip();
    const trigger = screen.getByRole("button", { name: "TVL: partial total" });
    expect(trigger).toHaveAccessibleDescription(NOTE);
    expect(trigger).not.toContainElement(tip());
    expect(tip()).not.toBeVisible();
  });

  it("opens on keyboard focus and closes on Escape", () => {
    renderTip();
    const trigger = screen.getByRole("button", { name: "TVL: partial total" });
    act(() => trigger.focus());
    expect(tip()).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip()).not.toBeVisible();
  });

  it("closes when focus leaves the trigger", () => {
    renderTip();
    const trigger = screen.getByRole("button", { name: "TVL: partial total" });
    act(() => trigger.focus());
    act(() => trigger.blur());
    expect(tip()).not.toBeVisible();
  });

  it("stays open while the pointer moves from the trigger onto the tip", () => {
    renderTip();
    const trigger = screen.getByRole("button", { name: "TVL: partial total" });
    fireEvent.mouseEnter(trigger);
    expect(tip()).toBeVisible();
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(tip());
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(tip()).toBeVisible();
    fireEvent.mouseLeave(tip());
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(tip()).not.toBeVisible();
  });

  it("opens on a tap or click and stays until tapped again or dismissed elsewhere", () => {
    renderTip();
    const trigger = screen.getByRole("button", { name: "TVL: partial total" });
    fireEvent.click(trigger);
    fireEvent.mouseLeave(trigger);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(tip()).toBeVisible();
    fireEvent.click(trigger);
    expect(tip()).not.toBeVisible();

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(tip()).not.toBeVisible();
  });

  it("renders the tip into the document body, outside any row or header that could cover or clip it", () => {
    const { container } = renderTip();
    expect(container).not.toContainElement(tip());
    expect(document.body).toContainElement(tip());
  });
});

describe("LabelValueRow help", () => {
  it("opens its help from the keyboard through a named button", () => {
    jest.useFakeTimers();
    try {
      render(<LabelValueRow label="Volume (24hr)" helpText="The USD Volume of pool trades in the last 24 hours." value="$1.00" />);
      const help = screen.getByRole("button", { name: "About Volume (24hr)" });
      expect(help).toHaveAccessibleDescription("The USD Volume of pool trades in the last 24 hours.");
      act(() => help.focus());
      expect(screen.getByRole("tooltip")).toHaveTextContent("The USD Volume of pool trades in the last 24 hours.");
    } finally {
      jest.useRealTimers();
    }
  });
});
