/** @jest-environment node */
import { FOCUS_OUTLINE_CLASS } from "./focusOutline";

describe("FOCUS_OUTLINE_CLASS", () => {
  it("draws a 2 px outline in the focus token, offset from the control, on keyboard focus only", () => {
    expect(FOCUS_OUTLINE_CLASS.split(" ").sort()).toEqual([
      "focus-visible:outline-2",
      "focus-visible:outline-focus",
      "focus-visible:outline-offset-2",
    ]);
  });
});
