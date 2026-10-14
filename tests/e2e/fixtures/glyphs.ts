import type { Locator } from "@playwright/test";

/**
 * P9f bidi probe (idle.spec.ts tickerGlyphX, over every text node of the
 * element): the on-screen x of the first `a` and `b` glyphs — the RENDERED
 * order, which only the BiDi algorithm decides. One evaluate, so a moving
 * marquee is measured in one frame. NaN (never in order) when a glyph is
 * missing.
 */
export function glyphX(locator: Locator, a: string, b: string) {
  return locator.evaluate(
    (el, [first, second]) => {
      const x = (glyph: string) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          const at = text.data.indexOf(glyph);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(text, at);
          range.setEnd(text, at + glyph.length);
          return range.getBoundingClientRect().x;
        }
        return Number.NaN;
      };
      return { a: x(first), b: x(second) };
    },
    [a, b]
  );
}
