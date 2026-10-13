import { describe, expect, it } from "vitest";
import en from "../locales/en/translation.json";
import ar from "../locales/ar/translation.json";
import enLazy from "../locales/en/lazy.json";
import arLazy from "../locales/ar/lazy.json";

/*
  Lane bag-pdp (I8): exactly 14 new keys, EN + AR together, all in the lazy
  copy (they render only from the lazy chunk — D7), none on the boot path; AR
  is a real draft (never the English copy); the boot keys the lane REUSES are
  still there in both languages. Raw resources, no i18next in the loop.
*/

const flatten = (node: unknown, prefix = ""): Array<[string, unknown]> =>
  node && typeof node === "object"
    ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
        flatten(value, prefix ? `${prefix}.${key}` : key),
      )
    : [[prefix, node]];

const LANE_KEYS = [
  "bag.orderType.confirmTitle",
  "bag.orderType.confirmBody",
  "bag.orderType.confirmYes",
  "bag.orderType.confirmNo",
  "bag.orderType.switching",
  "bag.orderType.failedTitle",
  "bag.orderType.failedBody",
  "bag.orderType.removedTitle",
  "bag.orderType.removedBody",
  "bag.editHowMany.title",
  "bag.editHowMany.body",
  "pdp.incomplete.titleBox",
  "pdp.incomplete.titleItem",
  "pdp.incomplete.body",
];

/** Boot copy the lane's surfaces reuse (no new key for these). */
const REUSED_KEYS = [
  "offers.gotIt",
  "menuError.retry",
  "menuError.back",
  "bag.eatIn",
  "bag.takeOut",
  "bag.edit",
  "bag.decrease",
  "bag.increase",
  "language.close",
  "keyboard.clear",
  "keyboard.backspace",
  "pdp.discardTitle",
  "pdp.discardBody",
  "pdp.discardKeep",
  "pdp.discardConfirm",
  "pack.save",
  "pack.selectGroup",
  "pack.included",
  "pack.upgrades",
  "pack.customize",
  "pack.cal",
];

/**
 * Lane audit-fixes (2026-10-08, foundation): the lazy-only copy it added —
 * U3 the cooking-instructions sheet, U2 the Activity Center's fullscreen
 * line, UB2 the size warning, UB5 the country picker. Parity, placeholders
 * and no-boot-shadowing are src/__tests__/localeParity's.
 */
const AUDIT_FIXES_LAZY_KEYS = [
  "bag.instructionsSheet.placeholder",
  "bag.instructionsSheet.counter",
  "bag.instructionsSheet.save",
  "activity.fullscreenOn",
  "activity.fullscreenOff",
  "pdp.incomplete.size",
  "country.title",
  "country.search",
  "country.noResults",
];

/** Lane motion-v2 (MV9): the Activity Center's "Animations" row — operator copy, lazy like its modal. */
const MOTION_V2_LAZY_KEYS = ["activity.animations", "activity.animationsOn", "activity.animationsOff"];

/**
 * Lane offers-parity (F3 / F5): the rewards rows' description copy — the
 * buy/get sentence, the item-criteria scope lines and the scoped lock
 * lines — lazy like the sheet that renders it. `offers.desc.category` is
 * a plural family (EN one/other, AR all six forms): the pin compares
 * families, the CLDR forms are localeParity's.
 */
const OFFERS_PARITY_LAZY_KEYS = [
  "offers.desc.buyGet",
  "offers.desc.getOnly",
  "offers.desc.buyOnly",
  "offers.desc.category",
  "offers.desc.categoryAny",
  "offers.desc.free",
  "offers.desc.percentOff",
  "offers.desc.amountOff",
  "offers.desc.each",
  "offers.desc.or",
  "offers.desc.comma",
  "offers.mechPercentItemsOnly",
  "offers.mechPercentItemsExcept",
  "offers.mechAmountItemsOnly",
  "offers.mechAmountItemsExcept",
  "offers.scopeSeparator",
  "offers.scopeMore",
  "offers.lockedItemCriteriaExcept",
  "offers.lockedItemCriteriaOnly",
];

const PLURAL = /_(zero|one|two|few|many|other)$/;
const family = (key: string) => key.replace(PLURAL, "");
const families = (keys: Iterable<string>) => [...new Set([...keys].map(family))].sort();

const EN_LAZY = new Map(flatten(enLazy));
const AR_LAZY = new Map(flatten(arLazy));
const EN_BOOT = new Map(flatten(en));
const AR_BOOT = new Map(flatten(ar));
const placeholders = (value: unknown) =>
  [...String(value).matchAll(/{{\s*([\w.]+)[^}]*}}/g)].map(([, name]) => name).sort();

describe("lane bag-pdp copy (I8)", () => {
  it("lazy.json holds exactly the 14 lane keys (+ audit-fixes' 9, motion-v2's 3, offers-parity's 19 families), in EN and in AR", () => {
    const expected = [
      ...LANE_KEYS,
      ...AUDIT_FIXES_LAZY_KEYS,
      ...MOTION_V2_LAZY_KEYS,
      ...OFFERS_PARITY_LAZY_KEYS,
    ].sort();
    expect(families(EN_LAZY.keys())).toEqual(expected);
    expect(families(AR_LAZY.keys())).toEqual(expected);
    // The only plural family: EN one/other, AR the six CLDR forms.
    const forms = (copy: Map<string, unknown>) =>
      [...copy.keys()].filter((key) => PLURAL.test(key)).sort();
    expect(forms(EN_LAZY)).toEqual(["offers.desc.category_one", "offers.desc.category_other"]);
    expect(forms(AR_LAZY)).toEqual(
      ["few", "many", "one", "other", "two", "zero"].map((form) => `offers.desc.category_${form}`)
    );
  });

  it("offers-parity: every AR value is an Arabic draft, never the English copy; the scope's +N is {{qty}} (no plural lookup)", () => {
    for (const [key, english] of EN_LAZY) {
      if (!OFFERS_PARITY_LAZY_KEYS.includes(family(key))) continue;
      const twin = AR_LAZY.has(key) ? key : `${family(key)}_other`;
      const arabic = String(AR_LAZY.get(twin));
      expect(arabic.trim(), key).not.toBe("");
      expect(arabic, key).not.toBe(String(english));
      expect(arabic, key).toMatch(/[؀-ۿ]/);
    }
    expect(placeholders(EN_LAZY.get("offers.scopeMore"))).toEqual(["qty"]);
    expect(placeholders(AR_LAZY.get("offers.scopeMore"))).toEqual(["qty"]);
    // None of them shadows the boot copy (deep merge into "offers").
    for (const key of OFFERS_PARITY_LAZY_KEYS) {
      expect([...EN_BOOT.keys()].some((boot) => family(boot) === key), key).toBe(false);
      expect([...AR_BOOT.keys()].some((boot) => family(boot) === key), key).toBe(false);
    }
  });

  it("every AR value is a non-blank Arabic draft, never the English copy, with the same placeholders", () => {
    for (const key of LANE_KEYS) {
      const english = String(EN_LAZY.get(key));
      const arabic = String(AR_LAZY.get(key));
      expect(english.trim(), key).not.toBe("");
      expect(arabic.trim(), key).not.toBe("");
      expect(arabic, key).not.toBe(english);
      expect(arabic, key).toMatch(/[؀-ۿ]/);
      expect(placeholders(arabic), key).toEqual(placeholders(english));
    }
  });

  it("the numpad title uses {{qty}} (a {{count}} would trigger i18next's plural lookup)", () => {
    expect(placeholders(EN_LAZY.get("bag.editHowMany.title"))).toEqual(["name", "qty"]);
    expect(LANE_KEYS.every((key) => !placeholders(EN_LAZY.get(key)).includes("count"))).toBe(true);
  });

  it("none of the lane keys sits in the boot translation.json (D7: they ride the lazy chunk)", () => {
    for (const key of LANE_KEYS) {
      expect(EN_BOOT.has(key), key).toBe(false);
      expect(AR_BOOT.has(key), key).toBe(false);
    }
    // …and the lane added no new top-level namespace to the boot copy either.
    expect(Object.keys(en).every((ns) => Object.keys(ar).includes(ns))).toBe(true);
  });

  it("the boot keys the lane reuses still exist in both languages", () => {
    for (const key of REUSED_KEYS) {
      expect(String(EN_BOOT.get(key) ?? "").trim(), `en ${key}`).not.toBe("");
      expect(String(AR_BOOT.get(key) ?? "").trim(), `ar ${key}`).not.toBe("");
    }
  });
});
