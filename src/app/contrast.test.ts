import { readFileSync } from "fs";
import path from "path";

/**
 * Holds the interaction tokens in globals.css to WCAG contrast: 4.5:1 for text, 3:1 for the focus ring. Colours
 * are read from the stylesheet, so a token edit that breaks a pair fails here.
 */

type Rgb = [number, number, number];

const css = readFileSync(path.join(__dirname, "globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`--color-${name} is not defined in globals.css`);
  return match[1].trim();
}

function hex(value: string): Rgb {
  const digits = value.replace("#", "");
  return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

/** `fg` at `alpha` laid over the opaque `bg`. */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((channel, i) => Math.round(channel * alpha + bg[i] * (1 - alpha))) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(channel => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
// The page gradient's two ends (.bg-theme-gradient); the lighter one is the hardest background for light text.
const GRADIENT_LIGHT = hex("#3057A6");
const GRADIENT_DARK = hex("#19245d");
const NAVY = hex(token("navy"));
const PAGE_BACKGROUNDS: Array<[string, Rgb]> = [
  ["the light end of the gradient", GRADIENT_LIGHT],
  ["the dark end of the gradient", GRADIENT_DARK],
  ["a bg-black/20 card", over([0, 0, 0], 0.2, GRADIENT_LIGHT)],
  ["a bg-navy/50 hover", over(NAVY, 0.5, GRADIENT_LIGHT)],
];
// Popovers render at 95% opacity over the page.
const POPOVER = over(hex(token("popover")), 0.95, GRADIENT_LIGHT);

describe("interaction token contrast", () => {
  it.each(PAGE_BACKGROUNDS)("link-hover text reads on %s", (_, background) => {
    expect(contrast(hex(token("link-hover")), background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PAGE_BACKGROUNDS)("the focus ring shows on %s", (_, background) => {
    expect(contrast(hex(token("focus")), background)).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["white", WHITE],
    ["primary", hex(token("primary"))],
  ] as Array<[string, Rgb]>)("%s text reads on the popover and on its selected option", (_, text) => {
    for (const surface of [POPOVER, hex(token("popover-selected"))]) {
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("white text on a navy hover reads at the enhanced 7:1 level", () => {
    expect(contrast(WHITE, over(NAVY, 0.5, GRADIENT_LIGHT))).toBeGreaterThanOrEqual(7);
  });
});
