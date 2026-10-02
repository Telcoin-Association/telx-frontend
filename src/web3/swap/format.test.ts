import { formatTokenAmountDown } from "./format";

describe("formatTokenAmountDown", () => {
  it.each([
    ["1233.6", "1,233"],
    ["1233.999999", "1,233"],
    ["99.999", "99.99"],
    ["5", "5"],
    ["0.123456", "0.1234"],
    ["0.00123459", "0.001234"],
    ["12345678.9", "12,345,678"],
    ["0", "0"],
    ["0.0000001", "<0.000001"],
  ])("shows %s as %s, never rounding up", (value, shown) => {
    expect(formatTokenAmountDown(value)).toBe(shown);
  });

  it("shows a balance that can be typed back and sent", () => {
    // A balance of 1233.6 typed back as shown never asks for more than the wallet holds.
    expect(Number(formatTokenAmountDown("1233.6").replace(/,/g, ""))).toBeLessThanOrEqual(1233.6);
  });

  it("keeps the sign of a negative amount", () => {
    expect(formatTokenAmountDown("-2.56789")).toBe("-2.567");
  });
});
