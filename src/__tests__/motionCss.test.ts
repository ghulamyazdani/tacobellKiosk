import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
  Lane motion — static pins on src/index.css's motion block (jsdom has no
  animation engine, so these read the CSS itself, like contrast.test).
  1. Reduced motion (D-M4): a 1 ms animation still PAINTS its from-keyframe
     once, so every non-loop first frame must be its end state under reduce
     — at full opacity (the product-added card flashed at 44 %) AND at
     opacity 0, whose offset box is still what a geometry read measures
     (motion-v2 MV8d).
  2. Figma loops (D-M7, "exactly as specified"): the hourglass (Loader 1,
     1:6301) and the EDC card tilt (Credit card 1, 1:5603) follow their GIFs
     frame by frame. CSS interpolation (per-segment cubic-bezier) is replayed
     here against the GIF's 40 ms frames (scratchpad motion/figma/*.txt);
     Chromium's own sampling agrees with this replay to 0.1°.
*/

const CSS = readFileSync(join(import.meta.dirname, "..", "index.css"), "utf8");

const keyframes = (name: string): string => {
  const block = CSS.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`no @keyframes ${name}`);
  return block[1];
};

/** The GIF frames, one per 40 ms (degrees; the hourglass unwrapped). */
const HOURGLASS =
  "0 0 0 0 0 0 0 0 0 0 0 1 1 3 4 6 9 13 19 26 35 100 157 174 181 185 190 193 196 197 198 199 200 200 200 200 199 198 184 181 180 180 180 180 180 180 180 180 180 180 180 180 180 181 182 183 185 187 191 194 199 210 222 326 345 354 363 367 372 374 376 378 378 379 380 380 380 380 378 376 364 361 360 360 360 360 360 360 360 360 360 360 360 360 360 360 360 360 360";
const CARD =
  "0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.2 0.1 0 -0.2 -0.5 -0.8 -1.9 -5.7 -10.1 -10.7 -11 -11.4 -11.5 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.7 -11.6 -11.4 -11.2 -10.7 -10.1 -8.9 -1.9 -1.1 -0.5 -0.2 0 0.1 0.2 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3 0.3";

const KEYWORDS: Record<string, number[]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};
const easing = (fn: string) => {
  const [x1, y1, x2, y2] = fn.startsWith("cubic-bezier")
    ? fn.slice(13, -1).split(",").map(Number)
    : KEYWORDS[fn];
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (p: number) => {
    let [lo, hi] = [0, 1];
    for (let i = 0; i < 40; i += 1) [lo, hi] = at(x1, x2, (lo + hi) / 2) < p ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    return at(y1, y2, (lo + hi) / 2);
  };
};

/** Worst |CSS − GIF| over every frame, replaying the keyframes as CSS does. */
const worstError = (name: string, frames: string) => {
  const fallback = CSS.match(new RegExp(`animation:\\s*${name}\\s+\\S+\\s+([\\w-]+)`))?.[1] ?? "ease";
  const stops = [
    ...keyframes(name).matchAll(/([\d.%,\s]+)\{\s*transform:\s*rotate\((-?[\d.]+)deg\);\s*(?:animation-timing-function:\s*([^;]+);)?\s*\}/g),
  ].flatMap(([, at, deg, fn]) => at.split(",").map((pct) => ({ at: parseFloat(pct), deg: Number(deg), fn: fn ?? fallback })));
  const gif = frames.split(" ").map(Number);
  return Math.max(
    ...gif.map((deg, i) => {
      const pct = (i / gif.length) * 100;
      const k = stops.filter((s) => s.at <= pct).length - 1; // stops ascend
      const [from, to] = [stops[k], stops[k + 1] ?? stops[k]];
      const css = from.deg + (to.deg - from.deg) * easing(from.fn)((pct - from.at) / (to.at - from.at || 1));
      return Math.abs(css - deg);
    })
  );
};

describe("the Figma loader loops follow their GIFs frame by frame (D-M7)", () => {
  it("parses the keyframe stops", () => {
    expect(keyframes("tb-hourglass")).toMatch(/rotate\(363deg\)/);
    expect(keyframes("tb-card-tilt")).toMatch(/rotate\(-12deg\)/);
  });

  it("tb-hourglass (Loader 1, 99 frames / 3.96 s): within 3° of every frame", () => {
    expect(worstError("tb-hourglass", HOURGLASS)).toBeLessThan(3);
  });

  it("tb-card-tilt (Credit card 1, 78 frames / 3.12 s): within 1° of every frame", () => {
    expect(worstError("tb-card-tilt", CARD)).toBeLessThan(1);
  });
});

/*
  The motion block's contract (motion contract §1, §2, §3, Appendix A), read
  from the source with its comments stripped (the prose names things the
  code must not do). Brace depth 0 = unlayered, top level.
*/
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

const depthAt = (index: number) => {
  let depth = 0;
  for (const ch of CODE.slice(0, index)) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
  return depth;
};

/** The body of the block whose header starts at `index` (brace-matched). */
const blockAt = (index: number) => {
  const open = CODE.indexOf("{", index);
  let depth = 0;
  for (let i = open; i < CODE.length; i += 1) {
    depth += CODE[i] === "{" ? 1 : CODE[i] === "}" ? -1 : 0;
    if (depth === 0) return CODE.slice(open + 1, i);
  }
  throw new Error(`unclosed block at ${index}`);
};
const block = (header: string) => {
  const index = CODE.indexOf(header);
  if (index < 0) throw new Error(`no ${header}`);
  return blockAt(index);
};
const declarations = (body: string): Record<string, string> =>
  Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(([, prop, value]) => [prop, value.trim()]));
/** The ONE rule whose selector is exactly `selector`. */
const rule = (selector: string) => {
  const at = [...CODE.matchAll(/([^{};]+)\{/g)].filter(([, head]) => head.trim() === selector);
  expect(at, selector).toHaveLength(1);
  return { depth: depthAt(at[0].index ?? 0), decl: declarations(blockAt(at[0].index ?? 0)) };
};

/** The motion tokens (the top-level :root that holds them, not the reduce override). */
const TOKENS = declarations(
  [...CODE.matchAll(/:root\s*\{([^}]*)\}/g)].find(
    (match) => match[1].includes("--tb-dur-spring") && depthAt(match.index ?? 0) === 0
  )?.[1] ?? ""
);
const REDUCE = block("@media (prefers-reduced-motion: reduce)");
const REDUCE_ROOT = declarations(REDUCE.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "");

describe("reduced motion: every non-loop first frame is its end state (D-M4; motion-v2 MV8d)", () => {
  /** Loops rest at their base frame: the keyframes an `infinite` animation here names. */
  const LOOPS = [...CODE.matchAll(/animation:\s*([\w-]+)[^;]*\binfinite\b/g)].map(([, name]) => name);
  /** Each non-loop @keyframes' first frame (`from` / `0%`, if written): its transform. */
  const FIRST = [...CODE.matchAll(/@keyframes ([\w-]+)\s*\{/g)].flatMap((match) => {
    const head = blockAt(match.index ?? 0).match(/^\s*([^{]+)\{([^}]*)\}/);
    const at = head?.[1].split(",").map((stop) => stop.trim()) ?? [];
    if (LOOPS.includes(match[1]) || !head || !(at.includes("from") || at.includes("0%"))) return [];
    return [{ name: match[1], transform: declarations(head[2]).transform ?? "" }];
  });
  /** A var() a rule defines (--tb-enter-x under [data-enter]) resolves to the tokens it is made of. */
  const tokensOf = (value: string): string[] =>
    [...value.matchAll(/var\((--[\w-]+)/g)].flatMap(([, name]) => {
      if (name in TOKENS) return [name];
      const defined = [...CODE.matchAll(/([^{};]+)\{([^{}]*)\}/g)].flatMap(([, , body]) => declarations(body)[name] ?? []);
      expect(defined, `${name} is a token or defined by a rule`).not.toEqual([]);
      return defined.flatMap(tokensOf);
    });

  it("the loops are the five allow-listed ones; the checked first frames include every entrance", () => {
    expect([...LOOPS].sort()).toEqual(["tb-attract", "tb-card-tilt", "tb-hourglass", "tb-indeterminate", "tb-marquee"]);
    expect(FIRST.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "tb-modal-enter", "tb-fade-in", "tb-confetti-fall", "tb-chip-pop", "tb-success-pulse", "tb-enter", "tb-rise",
        "tb-sheet-enter", "tb-modal-spring", "tb-pop-in", "tb-select", "tb-carousel-in",
      ])
    );
  });

  it.each(FIRST)("$name: every token in its first transform is the identity under reduce", ({ transform }) => {
    for (const token of tokensOf(transform)) expect(["1", "0", "0px"], token).toContain(REDUCE_ROOT[token]);
  });

  // `calc(-50% + var(--tb-dist-modal))` leaves the centring; `scale(0.85)` would leave an 85 % frame.
  it.each(FIRST)("$name: no literal other than 0 / 0px / 0deg / ±50 % in its first transform", ({ transform }) => {
    const literals = transform.replace(/var\([^()]*\)/g, "").match(/(?<![\w-])-?\d*\.?\d+[a-z%]*/g) ?? [];
    expect(literals.filter((literal) => !["0", "0px", "0deg", "50%", "-50%"].includes(literal))).toEqual([]);
  });

  it("no component carries its own @keyframes: index.css owns every one (motion-v2 MV8b / MV8c)", () => {
    const sources = import.meta.glob<string>("../**/*.tsx", { query: "?raw", import: "default", eager: true });
    const app = Object.entries(sources).filter(([file]) => !/(^|\/)__tests__\/|\.test\.tsx$/.test(file));
    expect(app.length).toBeGreaterThan(50);
    expect(app.filter(([, source]) => source.includes("@keyframes")).map(([file]) => file)).toEqual([]);
  });
});

describe("ONE global reduced-motion block (D-M4)", () => {
  it("is the only prefers-reduced-motion block in index.css", () => {
    expect(CODE.match(/prefers-reduced-motion/g)).toHaveLength(1);
  });

  // Transitions are 0 s, not the contract's 1 ms (lane integration, index.css
  // comment): `transition-property` defaults to `all`, so 1 ms on `*` made
  // every property change a one-frame transition (the ADA switch lagged).
  it("every animation ends in 1 ms with one pass and no delay; transitions are instant — all !important", () => {
    expect(declarations(REDUCE.match(/\*,\s*::before,\s*::after\s*\{([^}]*)\}/)?.[1] ?? "")).toEqual({
      "animation-delay": "0s !important",
      "animation-duration": "1ms !important",
      "animation-iteration-count": "1 !important",
      "transition-delay": "0s !important",
      "transition-duration": "0s !important",
    });
  });

  it("never `animation: none` — the centred modals' resting translate lives in their fill", () => {
    expect(CODE).not.toMatch(/animation(-name)?\s*:\s*none/);
  });

  it("the press squeeze stays off and the confetti hidden", () => {
    expect(declarations(REDUCE.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "")).toMatchObject({ "--tb-press-scale": "1" });
    expect(declarations(REDUCE.match(/\.tb-confetti-piece\s*\{([^}]*)\}/)?.[1] ?? "")).toEqual({ display: "none" });
  });
});

describe("the Figma product-added spring (D-M7, 1:5502 → 1:5521)", () => {
  it("958 ms, from 0.4437 (301.683 / 680)", () => {
    expect(TOKENS["--tb-dur-spring"]).toBe("958ms");
    expect(TOKENS["--tb-spring-from"]).toBe("0.4437");
  });

  it("Bouncy is ONE linear() token, used only inside @supports (animation-timing-function: linear(0, 1))", () => {
    expect(TOKENS["--tb-ease-bouncy"]).toMatch(/^linear\(0, [^()]+, 1\)$/);
    const supports = block("@supports (animation-timing-function: linear(0, 1))");
    expect(declarations(supports)).toEqual({
      "animation-duration": "var(--tb-dur-spring)",
      "animation-timing-function": "var(--tb-ease-bouncy)",
    });
    expect(supports).toMatch(/^\s*\.tb-modal-spring\s*\{/);
    expect(CODE.split("var(--tb-ease-bouncy)")).toHaveLength(2); // its one use, in there
  });

  it("without linear() it is a 400 ms spring cubic, both fill (the fill carries the centring)", () => {
    const fallback = [...CODE.matchAll(/\.tb-modal-spring\s*\{([^}]*)\}/g)].map(([, body]) => declarations(body));
    expect(fallback).toContainEqual({ animation: "tb-modal-spring 400ms var(--tb-ease-spring) both" });
  });

  it("the card springs at FULL opacity from the token scale to the resting translate", () => {
    const frames = keyframes("tb-modal-spring");
    expect(frames).toMatch(/from \{ transform: translate\(-50%, -50%\) scale\(var\(--tb-spring-from\)\); \}/);
    expect(frames).toMatch(/to \{ transform: translate\(-50%, -50%\); \}/);
    expect(frames).not.toMatch(/opacity/);
  });
});

describe("press (§3.1)", () => {
  // Equal specificity: on a button carrying two of the keys the LATER rule
  // wins. The /second card carries border-tb-surface AND bg-tb-surface and
  // must press lilac, not 15 % white over the purple texture.
  const FILLS: [string, string][] = [
    ["button.border-tb-surface", "rgb(255 255 255 / 0.15)"],
    ["button.bg-tb-purple", "var(--color-tb-purple-vibrant)"],
    ["button.bg-tb-surface", "var(--color-tb-lilac)"],
  ];
  // motion-v2 MV1: a fill answers :active OR the touch-down [data-pressed] (src/utils/pressFeedback.ts).
  const NOT = ':is(:active, [data-pressed]):not(:disabled, [aria-disabled="true"], .tb-no-press)';

  it("MV1: every active: / group-active: utility answers :active or [data-pressed] — the one custom variant", () => {
    expect(CODE.match(/@custom-variant[^;]*;/g)).toEqual(["@custom-variant active (&:is(:active, [data-pressed]));"]);
    expect(depthAt(CODE.indexOf("@custom-variant"))).toBe(0);
    // …and the three fills below. The squeeze and every .tb-press-* rule stay :active-only (motion, not state).
    expect(CODE.split("[data-pressed]")).toHaveLength(1 + 1 + FILLS.length);
  });

  it("the unlayered Figma pressed fills run border-tb-surface → bg-tb-purple → bg-tb-surface", () => {
    const at = FILLS.map(([key]) => CODE.indexOf(`${key}${NOT}`));
    expect(at.every((index) => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it.each(FILLS)("%s → %s: unlayered (beats the fill utility), never disabled or tb-no-press", (key, fill) => {
    expect(rule(`${key}${NOT}`)).toEqual({ depth: 0, decl: { "background-color": fill } });
  });

  it("the .97 squeeze is @layer base (any utility wins) and skips disabled, :empty overlays and tb-no-press", () => {
    expect(TOKENS["--tb-press-scale"]).toBe("0.97");
    expect(block("@layer base")).toMatch(
      /button:active:not\(:disabled, :empty, \[aria-disabled="true"\], \.tb-no-press\)\s*\{\s*scale: var\(--tb-press-scale\);\s*\}/
    );
  });

  it("a tb-press-card squeezes only while its DIRECT empty overlay is pressed", () => {
    expect(rule(".tb-press-card:has(> button:empty:active)").decl).toEqual({ scale: "var(--tb-press-scale)" });
  });

  it("a tb-press-hit card keeps its whole hit area while it squeezes: its ::before covers it and counter-scales (lane addon-cta)", () => {
    expect(rule(".tb-press-hit::before").decl).toEqual({
      content: '""',
      position: "absolute",
      inset: "0",
      transition: "scale var(--tb-dur-press) var(--tb-ease-press)",
    });
    expect(rule(".tb-press-hit:active::before").decl).toEqual({ scale: "calc(1 / var(--tb-press-scale))" });
  });

  it("the two-button option card (tb-press-card + tb-select) springs back AT ONCE and its pressed overlay sits on top: a held press in the gap never lands on the REMOVE its squeeze lifted (lane addon-customize; e2e E13)", () => {
    expect(rule(".tb-press-card.tb-select").decl).toEqual({ transition: "none" });
    expect(rule(".tb-press-card.tb-select:has(> button:empty:active)").decl).toEqual({
      transition: "scale var(--tb-dur-press) var(--tb-ease-press)",
    });
    expect(rule(".tb-press-card.tb-select > button:empty:active").decl).toEqual({ "z-index": "20" });
  });
});

describe("route entrances (§2)", () => {
  it("play only under a [data-enter] root: 40 px from the right (fwd) or the left (back), 260 ms, stagger capped at 7", () => {
    expect(rule('[data-enter="fwd"]').decl).toEqual({ "--tb-enter-x": "var(--tb-dist-page)" });
    expect(rule('[data-enter="back"]').decl).toEqual({ "--tb-enter-x": "calc(var(--tb-dist-page) * -1)" });
    expect(rule("[data-enter] .tb-enter").decl).toEqual({
      animation: "tb-enter var(--tb-dur-page) var(--tb-ease-out) backwards",
      "animation-delay": "calc(min(var(--i, 0), 7) * var(--tb-stagger))",
    });
    // No bare .tb-enter rule: a block outside a [data-enter] root never moves.
    const heads = [...CODE.matchAll(/([^{};]+)\{/g)].map(([, head]) => head.trim());
    expect(heads.filter((head) => /\.tb-enter\b/.test(head))).toEqual(["[data-enter] .tb-enter"]);
    expect(keyframes("tb-enter")).toMatch(/from \{ opacity: 0; transform: translateX\(var\(--tb-enter-x, 0px\)\); \}/);
    expect(TOKENS).toMatchObject({ "--tb-dist-page": "40px", "--tb-dur-page": "260ms", "--tb-stagger": "40ms" });
  });

  it("tb-select plays only while aria-pressed / aria-checked / aria-current is true", () => {
    expect(rule('.tb-select:is([aria-pressed="true"], [aria-checked="true"], [aria-current="true"])').decl).toEqual({
      animation: "tb-select var(--tb-dur-select) var(--tb-ease-spring) backwards",
    });
  });

  it("…and on the two-button option card, whose select state is data-selected (lane addon-customize)", () => {
    expect(rule('.tb-select[data-selected="true"]').decl).toEqual({
      animation: "tb-select var(--tb-dur-select) var(--tb-ease-spring) backwards",
    });
  });
});

describe("keyframes and classes (§1.5, §4)", () => {
  const ALL = [...CODE.matchAll(/@keyframes ([\w-]+)\s*\{/g)].map((match) => [match[1], blockAt(match.index ?? 0)]);

  it("every @keyframes animates opacity and transform only (compositor-only; per-stop easing allowed)", () => {
    expect(ALL.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        "tb-enter", "tb-rise", "tb-sheet-enter", "tb-modal-spring", "tb-pop-in", "tb-bump", "tb-select",
        "tb-shake", "tb-wiggle", "tb-carousel-in", "tb-attract", "tb-indeterminate", "tb-hourglass", "tb-card-tilt",
      ])
    );
    for (const [name, frames] of ALL) {
      const props = new Set([...frames.matchAll(/([\w-]+)\s*:/g)].map(([, prop]) => prop));
      props.delete("animation-timing-function");
      expect([...props].filter((prop) => prop !== "opacity" && prop !== "transform"), name).toEqual([]);
    }
  });

  it("enter-only: no exit / leave / close keyframes (closing is instant, D-M2)", () => {
    expect(ALL.map(([name]) => name).filter((name) => /exit|leave|close|-out\b/.test(name))).toEqual([]);
  });

  it("from-only entrances keep the element's own end state (backwards); the centred cards and sheets keep both", () => {
    const fill = (selector: string) => rule(selector).decl.animation.split(" ").at(-1);
    expect(fill(".tb-rise")).toBe("backwards");
    expect(fill(".tb-pop-in")).toBe("backwards");
    expect(fill(".tb-carousel-in")).toBe("backwards");
    expect(fill(".tb-sheet-enter")).toBe("both");
    expect(fill(".tb-modal-enter")).toBe("both");
  });

  it("nothing in the motion block takes a tap away (no pointer-events)", () => {
    const motion = CODE.slice(CODE.indexOf("--tb-dur-press"), CODE.indexOf("@media (prefers-reduced-motion"));
    expect(`${motion}${REDUCE}`).not.toMatch(/pointer-events/);
  });

  it("no will-change anywhere in src (CSS or class)", () => {
    const SRC = join(import.meta.dirname, "..");
    const hits = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(tsx?|css)$/.test(file) && !/(^|\/)__tests__\/|\.test\.tsx?$/.test(file))
      .filter((file) => readFileSync(join(SRC, file), "utf8").includes("will-change"));
    expect(hits).toEqual([]);
  });

  it("the two Figma press colours are @theme tokens", () => {
    expect(declarations(block("@theme"))).toMatchObject({
      "--color-tb-purple-press": "#883ed2",
      "--color-tb-red-press": "#c02121",
    });
  });

  it("tb-modal-enter is unchanged — same name, unlayered, its centring fill — now on the tokens (200 ms, 40 px)", () => {
    expect(rule(".tb-modal-enter")).toEqual({
      depth: 0,
      decl: { animation: "tb-modal-enter var(--tb-dur-modal) var(--tb-ease-out) both" },
    });
    const frames = keyframes("tb-modal-enter");
    expect(frames).toMatch(/from \{ opacity: 0; transform: translate\(-50%, calc\(-50% \+ var\(--tb-dist-modal\)\)\); \}/);
    expect(frames).toMatch(/to \{ opacity: 1; transform: translate\(-50%, -50%\); \}/);
    expect(TOKENS).toMatchObject({
      "--tb-dur-modal": "200ms",
      "--tb-dist-modal": "40px",
      "--tb-ease-out": "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  });
});

describe("lane motion-v2", () => {
  // A wait under 1 s needs no indicator (NN/g): a full-screen status overlay stays invisible for its
  // first 300 ms, then fades in over 200 ms. `backwards` holds opacity 0 through the delay; the
  // overlay is mounted (and takes taps) from t = 0. Reduce zeroes the delay (the global block).
  it("MV4: .tb-reveal-late = tb-fade-in, 200 ms, after 300 ms, backwards fill — in the motion components layer", () => {
    expect(rule(".tb-reveal-late")).toEqual({
      depth: 1,
      decl: { animation: "tb-fade-in var(--tb-dur-reveal) var(--tb-ease-out) var(--tb-reveal-delay) backwards" },
    });
    expect(TOKENS).toMatchObject({ "--tb-dur-reveal": "200ms", "--tb-reveal-delay": "300ms" });
    expect(keyframes("tb-fade-in")).toMatch(/from \{ opacity: 0; \}/);
  });

  // The EDC screen points at the card machine (bottom-right): three 1.2 s nudges after the page entrance,
  // done by 3.86 s — a finite run, not a loop (WCAG 2.2.2 needs none under 5 s). Reduce zeroes the distance.
  it("MV6: tb-nudge moves only by the distance token, three runs after the page entrance; reduce zeroes it", () => {
    expect(keyframes("tb-nudge").trim()).toBe(
      "50% { transform: translate(var(--tb-dist-nudge), var(--tb-dist-nudge)); }"
    );
    expect(rule(".tb-nudge")).toEqual({
      depth: 1,
      decl: { animation: "tb-nudge var(--tb-dur-nudge) ease-in-out var(--tb-dur-page) 3" },
    });
    expect(TOKENS).toMatchObject({ "--tb-dur-nudge": "1200ms", "--tb-dist-nudge": "12px", "--tb-dur-page": "260ms" });
    expect(REDUCE_ROOT["--tb-dist-nudge"]).toBe("0px");
  });
});

/*
  Order Complete's START NEW ORDER countdown (user 2026-10-14; design
  language). The page feeds the duration from ORDER_SUCCESS_COUNTDOWN_SECONDS
  (the unit suite checks that side); the CSS is ONE linear transform run
  that nothing waits on, from the left edge (LTR in Arabic too).
*/
describe("the Order Complete countdown fill (user 2026-10-14)", () => {
  /** The first `.tb-countdown-fill { … }` in `scope`. */
  const fillRule = (scope: string) =>
    declarations(scope.match(/(?:^|[};])\s*\.tb-countdown-fill\s*\{([^}]*)\}/)?.[1] ?? "");

  it("slides in linearly over the page's --tb-countdown (no token), from-only + backwards so it rests as its own full box", () => {
    expect(fillRule(CODE)).toEqual({
      "--tb-countdown-from": "-100%",
      animation: "tb-countdown-fill var(--tb-countdown) linear backwards",
    });
    expect(keyframes("tb-countdown-fill").trim()).toBe("from { transform: translateX(var(--tb-countdown-from)); }");
    expect(TOKENS["--tb-countdown"]).toBeUndefined();
  });

  it("grows from the left edge in Arabic too, like the idle prompt's START AGAIN (RTL text, LTR layout): no [dir] / :lang rule re-aims it — nothing ever sets dir=rtl, so one would be dead", () => {
    const heads = [...CODE.matchAll(/([^{};]+)\{/g)].map(([, head]) => head.trim());
    // The run and its reduce rule, nothing else.
    expect(heads.filter((head) => head.includes(".tb-countdown-fill"))).toEqual([".tb-countdown-fill", ".tb-countdown-fill"]);
  });

  it("hidden under reduce: at rest it would be FULL all along, and its empty from-frame never paints — the digits carry the countdown", () => {
    expect(fillRule(REDUCE)).toEqual({ display: "none" });
  });
});
