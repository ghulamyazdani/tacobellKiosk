import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../redux/app/store";
import SelectSizeModal from "../components/menu/SelectSizeModal";
import "../i18n";

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

/*
  Lane figma-polish S2: the disabled Select-a-Size CTA is Figma Grey 3
  (#B9B9B9, sampled on 1:5646) under white text — ≈ 2.0:1, below AA. WCAG
  1.4.3 exempts text on an INACTIVE control only, so Grey 3 may only ever fill
  a control while it is `disabled` (and the enabled CTA is purple, ≈ 11:1).
*/
describe("Grey 3 — only on a disabled control (lane figma-polish S2)", () => {
  it("white on tb-grey-3 is ≈ 2.0:1 — under 4.5, so it is exempt only as a disabled control", () => {
    expect(BASE["tb-grey-3"]).toBe("#b9b9b9");
    expect(contrast("white", "tb-grey-3")).toBeCloseTo(1.96, 2);
    expect(contrast("white", "tb-grey-3")).toBeLessThan(4.5);
    expect(contrast("white", "tb-purple")).toBeGreaterThanOrEqual(4.5);
  });

  it("bg-tb-grey-3 fills only SelectSizeModal's CTA — and that CTA is `disabled` exactly while it is grey", () => {
    const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !/(^|\/)__tests__\/|\.test\.tsx?$/.test(file))
      .filter((file) => readFileSync(join(SRC, file), "utf8").includes("bg-tb-grey-3"));
    expect(sources).toEqual(["components/menu/SelectSizeModal.tsx"]);

    const entity = {
      id: "box",
      name: "Box",
      variants: [
        { id: "v-l", name: "Large", price: 8, isActive: true },
        { id: "v-r", name: "Regular", price: 6, isActive: true },
      ],
    };
    render(
      createElement(Provider, {
        store,
        children: createElement(SelectSizeModal, { entity, onClose: vi.fn(), onContinue: vi.fn() }),
      })
    );
    const cta = screen.getByTestId("size-continue");

    expect(cta).toHaveClass("bg-tb-grey-3", "text-tb-surface");
    expect(cta).toBeDisabled();

    fireEvent.click(screen.getByTestId("size-v-r"));
    expect(cta).toBeEnabled();
    expect(cta).not.toHaveClass("bg-tb-grey-3");
    expect(cta).toHaveClass("bg-tb-purple");
  });
});
