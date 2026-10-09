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
/**
 * An i18next plural form (`key_one`, `key_other`, …). Each locale carries its
 * own language's CLDR set, so EN and AR differ by design in the forms only.
 */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const family = (key: string) => key.replace(PLURAL, "");

describe("locale parity — en ↔ ar", () => {
  it("both locales define exactly the same keys (plural families compared by family)", () => {
    const enFamilies = new Set([...EN.keys()].map(family));
    const arFamilies = new Set([...AR.keys()].map(family));
    const onlyEn = [...enFamilies].filter((key) => !arFamilies.has(key));
    const onlyAr = [...arFamilies].filter((key) => !enFamilies.has(key));

    expect({ onlyEn, onlyAr }).toEqual({ onlyEn: [], onlyAr: [] });
    expect(EN.size).toBeGreaterThan(0);
  });

  it("a plural family carries exactly its language's CLDR forms, and never a bare key beside them", () => {
    const wrong = (copy: Map<string, unknown>, lng: string) => {
      const want = [...new Intl.PluralRules(lng).resolvedOptions().pluralCategories].sort().join();
      const forms = new Map<string, string[]>();
      for (const key of copy.keys()) {
        const suffix = PLURAL.exec(key)?.[1];
        if (suffix) forms.set(family(key), [...(forms.get(family(key)) ?? []), suffix]);
      }
      return [...forms]
        .filter(([base, suffixes]) => suffixes.sort().join() !== want || copy.has(base))
        .map(([base]) => base);
    };

    expect({ en: wrong(EN, "en"), ar: wrong(AR, "ar") }).toEqual({ en: [], ar: [] });
  });

  it("every value is non-blank copy", () => {
    const blank = [...EN, ...AR]
      .filter(([, value]) => typeof value !== "string" || value.trim() === "")
      .map(([key]) => key);

    expect(blank).toEqual([]);
  });

  it("every key interpolates the same {{placeholders}} in both", () => {
    // A plural form may spell its number out ("عنصرين"), so {{count}} is not
    // compared there; an AR-only form (zero / two / few / many) answers to
    // EN's `_other`.
    const names = (key: string, value: unknown) =>
      placeholders(value)
        .filter((name) => !(PLURAL.test(key) && name === "count"))
        .join();
    const mismatched = [...AR]
      .filter(([key, value]) => {
        const twin = EN.has(key) ? key : `${family(key)}_other`;
        return names(key, value) !== names(twin, EN.get(twin));
      })
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

  it.each([
    ["loyalty.pointsBalanceLine", ["points"]],
    ["loyalty.pointsBalanceLineAlias", ["alias", "points"]],
    ["loyalty.pointsCostAlias", ["alias", "points"]],
    ["loyalty.offersLocked", []],
  ])("lane loyalty-visual: %s exists in both with the same placeholders", (key, expected) => {
    expect(EN.get(key), key).toEqual(expect.any(String));
    expect(AR.get(key), key).toEqual(expect.any(String));
    expect(placeholders(EN.get(key))).toEqual(expected);
    expect(placeholders(AR.get(key))).toEqual(expected);
  });

  it.each([
    ["toast.dpMaxQuantity_other", ["count", "session"]],
    ["second.noPipelines", []],
    ["pdp.groupCount", ["count", "max"]],
    ["pack.choose", []],
    ["pack.remove", []],
  ])("lane figma-polish: %s exists in both (boot copy, not lazy.json) with the same placeholders", (key, expected) => {
    expect(flatten(en).some(([path]) => path === key), key).toBe(true);
    expect(flatten(ar).some(([path]) => path === key), key).toBe(true);
    expect(placeholders(EN.get(key))).toEqual(expected);
    expect(placeholders(AR.get(key))).toEqual(expected);
    expect(AR.get(key)).not.toBe(EN.get(key));
  });
});
