import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en/translation.json";
import ar from "../i18n/locales/ar/translation.json";
import enLazy from "../i18n/locales/en/lazy.json";
import arLazy from "../i18n/locales/ar/lazy.json";

/*
  EN and AR must stay key-for-key identical: a key missing from one locale
  renders as its raw key path on a customer screen in that language (the
  splash resets the session to EN, so most AR copy is only reachable here).
  Each value must be non-blank copy with the same {{placeholders}}, or the
  interpolated value (a countdown, a price) silently drops out. lazy.json
  (copy the lazy chunks register — i18n/lazyCopy) is held to the same rules.
*/

/** "a.b.c" → value, for every leaf. */
const flatten = (node: unknown, prefix = ""): Array<[string, unknown]> =>
  node !== null && typeof node === "object" && !Array.isArray(node)
    ? Object.entries(node).flatMap(([key, value]) =>
        flatten(value, prefix ? `${prefix}.${key}` : key)
      )
    : [[prefix, node]];

const EN = new Map([...flatten(en), ...flatten(enLazy)]);
const AR = new Map([...flatten(ar), ...flatten(arLazy)]);
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

  it("lazy.json never shadows a boot key and resolves in both languages once i18n/lazyCopy ran", async () => {
    // Before the merge: i18next deep-merges INTO the imported translation objects.
    const boot = new Set(flatten(en).map(([key]) => key));
    expect(flatten(enLazy).filter(([key]) => boot.has(key))).toEqual([]);
    const { default: i18n } = await import("../i18n");
    await import("../i18n/lazyCopy");
    for (const [lng, copy] of [["en", enLazy], ["ar", arLazy]] as const) {
      for (const [key, value] of flatten(copy)) {
        expect(i18n.getResource(lng, "translation", key), `${lng} ${key}`).toBe(value);
      }
    }
  });
});
