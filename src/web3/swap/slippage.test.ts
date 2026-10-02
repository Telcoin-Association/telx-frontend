import { parseSlippagePercent, readSlippageChoice, slippageLabel, SLIPPAGE_STORAGE_KEY, writeSlippageChoice } from "./slippage";

describe("parseSlippagePercent", () => {
  it.each([
    ["0.75", 75, false],
    ["0,3", 30, false],
    ["2", 200, false],
    ["2.5", 250, true],
    ["50", 5000, true],
    ["0.01", 1, false],
  ])("accepts %s%% as %i bps (high: %s)", (text, bps, high) => {
    expect(parseSlippagePercent(text)).toEqual({ ok: true, bps, high });
  });

  it.each([
    ["", "Enter a slippage percentage, such as 0.5."],
    ["abc", "Enter a slippage percentage, such as 0.5."],
    ["0", "Slippage must be at least 0.01%."],
    ["0.001", "Slippage must be at least 0.01%."],
    ["50.5", "Slippage can't be more than 50%."],
    ["-1", "Enter a slippage percentage, such as 0.5."],
  ])("refuses %p", (text, message) => {
    expect(parseSlippagePercent(text)).toEqual({ ok: false, message });
  });
});

describe("remembering the slippage", () => {
  const memory = () => {
    const store = new Map<string, string>();
    return { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  };

  it("reads back what was written", () => {
    const storage = memory();
    writeSlippageChoice(storage, { bps: 75, custom: true });
    expect(readSlippageChoice(storage)).toEqual({ bps: 75, custom: true });
  });

  it.each(["not json", JSON.stringify({ bps: 0 }), JSON.stringify({ bps: 6000 }), JSON.stringify({ bps: 1.5 })])("ignores a stored %s", (raw) => {
    expect(readSlippageChoice({ getItem: (key) => (key === SLIPPAGE_STORAGE_KEY ? raw : null) })).toBeNull();
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readSlippageChoice(throwing)).toBeNull();
    expect(() => writeSlippageChoice(throwing, { bps: 50, custom: false })).not.toThrow();
  });
});

it.each([
  [10, "0.1%"],
  [50, "0.5%"],
  [100, "1%"],
  [75, "0.75%"],
])("labels %i bps as %s", (bps, label) => {
  expect(slippageLabel(bps)).toBe(label);
});
