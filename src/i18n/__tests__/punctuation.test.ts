import { describe, expect, it } from "vitest";
import en from "../locales/en/translation.json";
import ar from "../locales/ar/translation.json";
import enLazy from "../locales/en/lazy.json";
import arLazy from "../locales/ar/lazy.json";

/*
  Walk 2026-10-14: the Remove item and Cancel order bodies read "…, would you
  like to continue ?" (Figma 1:4551 / 1:4552 draw that typo). The frames'
  wording stays; the punctuation is fixed — and no copy, in either language,
  puts a space before ? ! or ؟ again. Raw resources, no i18next in the loop.
*/

const flatten = (node: unknown, prefix = ""): Array<[string, unknown]> =>
  node && typeof node === "object"
    ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
        flatten(value, prefix ? `${prefix}.${key}` : key),
      )
    : [[prefix, node]];

describe("copy punctuation", () => {
  it("no EN or AR string puts a space before ? ! or ؟", () => {
    const offenders = Object.entries({ en, ar, enLazy, arLazy }).flatMap(([file, copy]) =>
      flatten(copy)
        .filter(([, value]) => typeof value === "string" && /\s[?!؟]/.test(value))
        .map(([key]) => `${file}:${key}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the two confirm bodies keep the frames' words as two sentences", () => {
    expect(en.removeItem.body).toBe("You are about to delete this item. Would you like to continue?");
    expect(en.cancelOrder.body).toBe("You are about to cancel your order. Would you like to continue?");
    // AR mirrors it: the Arabic comma between the clauses becomes a full stop.
    for (const body of [ar.removeItem.body, ar.cancelOrder.body]) {
      expect(body).not.toContain("،");
      expect(body).toMatch(/\. .+؟$/);
    }
  });
});
