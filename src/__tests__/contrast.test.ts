import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
  P9f (rtl-a11y §3.7) — the only automated contrast guard for the textured and
  gradient screens, where axe reports "incomplete". WCAG 2.x ratios computed
  from the live tokens in src/index.css (a token edit that breaks a pair fails
  here), plus static guards for the two fixed regressions.
*/

const SRC = join(import.meta.dirname, "..");
const CSS = readFileSync(join(SRC, "index.css"), "utf8");
const TOKENS = Object.fromEntries(
  [...CSS.matchAll(/--color-(tb-[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, hex]) => [name, hex])
);
const BASE: Record<string, string> = { ...TOKENS, white: "#ffffff", black: "#000000" };

type Rgb = [number, number, number];
const rgb = (name: string): Rgb => {
  const hex = BASE[name];
  if (!hex) throw new Error(`no colour token ${name}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
};
const luminance = (c: Rgb) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** fg (optionally at Tailwind's /alpha, composited in 8 bits) on bg. */
const contrast = (fg: string, bg: string, alpha = 1) => {
  const back = rgb(bg);
  const front = rgb(fg).map((v, i) => Math.round(v * alpha + back[i] * (1 - alpha))) as Rgb;
  const [hi, lo] = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

describe("tb-* text pairs meet WCAG AA 4.5:1 (P9f)", () => {
  it("parses the palette from src/index.css", () => {
    expect(Object.keys(TOKENS)).toEqual(
      expect.arrayContaining(["tb-purple", "tb-purple-vibrant", "tb-pink", "tb-pink-dark", "tb-red", "tb-yellow", "tb-lilac", "tb-grey-6", "tb-ink-purple"])
    );
  });

  it("reproduces the audited ratios, including the pairs P9f fixed", () => {
    expect(contrast("white", "tb-pink")).toBeCloseTo(2.46, 2);
    expect(contrast("black", "white", 0.35)).toBeCloseTo(2.43, 2);
    expect(contrast("tb-ink-purple", "tb-grey-6", 0.4)).toBeCloseTo(2.65, 2);
    expect(contrast("tb-ink-purple", "tb-pink")).toBeCloseTo(7.73, 2);
  });

  it.each([
    ["white", "tb-purple"],
    ["white", "tb-purple-vibrant"],
    ["white", "tb-pink-dark"],
    ["white", "tb-red"],
    ["tb-purple", "tb-pink"],
    ["tb-ink-purple", "tb-pink"], // pink CTAs incl. Registration ACTIVATE (white was 2.46)
    ["black", "tb-yellow"],
    ["tb-purple", "white"],
    ["tb-purple", "tb-grey-6"],
    ["tb-purple", "tb-lilac"],
    ["tb-purple-vibrant", "white"],
    ["tb-pink-dark", "white"],
  ])("%s on %s", (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["black", 0.55, "white"], // placeholders on Registration, /phone, /customerName (/35 was 2.43)
    ["tb-ink-purple", 0.6, "tb-grey-6"], // pack-slot placeholder (/40 was 2.65)
  ])("%s/%s on %s (the P9f placeholder fixes)", (fg, alpha, bg) => {
    expect(contrast(fg, bg, alpha)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("contrast regressions stay fixed (static)", () => {
  const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/(^|\/)__tests__\/|\.test\.tsx?$/.test(file))
    .map((file) => ({ file, source: readFileSync(join(SRC, file), "utf8") }));

  // ponytail: per string literal — a class list split across nested template
  // literals escapes it; an AST walk if that ever matters.
  it("no class string puts white text on tb-pink (2.46:1)", () => {
    const offenders = sources.flatMap(({ file, source }) =>
      (source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [])
        .filter((s) => /\bbg-tb-pink(?![\w-])/.test(s) && /\btext-(?:white|tb-surface)\b/.test(s))
        .map(() => file)
    );
    expect(sources.length).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it("no 35 % black text is left (placeholders were 2.43:1)", () => {
    expect(sources.filter(({ source }) => source.includes("text-black/35")).map(({ file }) => file)).toEqual([]);
  });
});
