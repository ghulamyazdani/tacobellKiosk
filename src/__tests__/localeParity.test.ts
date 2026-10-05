import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en/translation.json";
import ar from "../i18n/locales/ar/translation.json";

/*
  EN and AR must stay key-for-key identical: a key missing from one locale
  renders as its raw key path on a customer screen in that language (the
  splash resets the session to EN, so most AR copy is only reachable here).
  Each value must be non-blank copy with the same {{placeholders}}, or the
  interpolated value (a countdown, a price) silently drops out.
*/

/** "a.b.c" → value, for every leaf. */
const flatten = (node: unknown, prefix = ""): Array<[string, unknown]> =>
  node !== null && typeof node === "object" && !Array.isArray(node)
    ? Object.entries(node).flatMap(([key, value]) =>
        flatten(value, prefix ? `${prefix}.${key}` : key)
      )
    : [[prefix, node]];

const EN = new Map(flatten(en));
const AR = new Map(flatten(ar));
const placeholders = (value: unknown) =>
  [...String(value).matchAll(/{{\s*([\w.]+)[^}]*}}/g)].map(([, name]) => name).sort();

describe("locale parity — en ↔ ar", () => {
  it("both locales define exactly the same keys", () => {
    const onlyEn = [...EN.keys()].filter((key) => !AR.has(key));
    const onlyAr = [...AR.keys()].filter((key) => !EN.has(key));

    expect({ onlyEn, onlyAr }).toEqual({ onlyEn: [], onlyAr: [] });
    expect(EN.size).toBeGreaterThan(0);
  });

  it("every value is non-blank copy", () => {
    const blank = [...EN, ...AR]
      .filter(([, value]) => typeof value !== "string" || value.trim() === "")
      .map(([key]) => key);

    expect(blank).toEqual([]);
  });

  it("every key interpolates the same {{placeholders}} in both", () => {
    const mismatched = [...EN]
      .filter(([key, value]) => placeholders(value).join() !== placeholders(AR.get(key)).join())
      .map(([key]) => key);

    expect(mismatched).toEqual([]);
  });

  it("the P9e update and Activity Center copy exists in both (countdown keeps its {{seconds}})", () => {
    for (const key of [
      "update.title",
      "update.countdown",
      "update.inProgress",
      "update.body",
      "activity.reloadResources",
      "activity.dataLoaded",
    ]) {
      expect(EN.get(key), key).toEqual(expect.any(String));
      expect(AR.get(key), key).toEqual(expect.any(String));
    }
    expect(placeholders(AR.get("update.countdown"))).toEqual(["seconds"]);
  });
});
