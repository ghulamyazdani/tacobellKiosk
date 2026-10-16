import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
  Perf pass, lane paint-touch — static pins on src/index.css (jsdom applies no
  stylesheet, so like motionCss.test and fonts.test this reads the CSS; the
  computed values in a real Chromium are tests/e2e/paintTouch.spec.ts').
*/
const CODE = readFileSync(join(import.meta.dirname, "..", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the block whose `{` follows `at`, brace-matched. */
const blockAt = (at: number) => {
  const open = CODE.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CODE.length; i += 1) {
    depth += CODE[i] === "{" ? 1 : CODE[i] === "}" ? -1 : 0;
    if (depth === 0) return CODE.slice(open + 1, i);
  }
  throw new Error(`unclosed block at ${at}`);
};
/** Every `@layer <name> { … }` body, in source order. */
const layers = (name: string) =>
  [...CODE.matchAll(new RegExp(`@layer\\s+${name}\\s*\\{`, "g"))].map((match) => blockAt(match.index ?? 0));
/** The declarations of each flat rule in `body` whose selector list is exactly `selector`. */
const rulesIn = (body: string, selector: string) =>
  [...body.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
    .filter(([, head]) => head.replace(/\s+/g, " ").trim() === selector)
    .map(([, , decls]) => Object.fromEntries([...decls.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, prop, value]) => [prop, value.trim()])));

describe("perf PAINT-1: a scroller paints its own surface", () => {
  // At a device scale below 1.5 Chromium composites a scroller only when its OWN opaque background covers its
  // contents; without one, every scroll frame of the menu, the PDP, the bag and the sheets is a main-thread
  // repaint. Layered under the utilities, so a scroller over another surface opts out with a bg-* utility.
  it("both scroller classes paint tb-surface from @layer components, and no other rule paints them", () => {
    expect(layers("components").flatMap((body) => rulesIn(body, ".overflow-y-auto, .overflow-x-auto"))).toEqual([
      { "background-color": "var(--color-tb-surface)" },
    ]);
    const heads = [...CODE.matchAll(/([^{};]+)\{/g)].map(([, head]) => head);
    expect(heads.filter((head) => /\.overflow-[xy]-auto\b/.test(head))).toHaveLength(1);
  });

  // The scrollers whose white would change a pixel keep today's paint with bg-transparent (pixel-identical pass).
  it.each([
    ["pages/SecondLayout/index.tsx", "the swipe row sits on the purple texture"],
    ["components/cart/EditHowManyModal.tsx", "its box meets the card's anti-aliased top edge (a second AA edge)"],
    ["components/makeItAMeal/MakeItAMealPrompt.tsx", "its box meets the card's anti-aliased top edge (a second AA edge)"],
    ["pages/Menu/index.tsx", "the card photos multiply-blend: composited, each photo becomes its own re-sampled layer"],
    ["components/menu/CategoryRail.tsx", "painted before the menu photos' blend, it would split them the same way"],
    ["components/offer/BuyStageSheet.tsx", "the tile photos multiply-blend (as the menu pane)"],
  ])("%s keeps its scroller transparent: %s", (file) => {
    const source = readFileSync(join(import.meta.dirname, "..", file), "utf8");
    const scrollers = [...source.matchAll(/"[^"]*\boverflow-[xy]-auto\b[^"]*"/g)].map(([classes]) => classes);
    expect(scrollers).not.toEqual([]);
    expect(scrollers.filter((classes) => !/\bbg-transparent\b/.test(classes))).toEqual([]);
  });
});

describe("perf PAINT-4: kiosk touch hardening", () => {
  // Desktop Chrome / Edge ignore the viewport meta's user-scalable=no: without these a two-finger pinch zooms
  // the stage for every later guest, and a held touch on a picture lifts a drag ghost.
  it("the root is pan-only and pictures never drag — in the FIRST @layer base block", () => {
    const [base] = layers("base");
    expect(rulesIn(base, "html")).toEqual([{ "touch-action": "pan-x pan-y" }]);
    expect(rulesIn(base, "img")).toEqual([{ "-webkit-user-drag": "none" }]);
  });
});
