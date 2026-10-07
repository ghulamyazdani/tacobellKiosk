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

const EN_LAZY = new Map(flatten(enLazy));
const AR_LAZY = new Map(flatten(arLazy));
const EN_BOOT = new Map(flatten(en));
const AR_BOOT = new Map(flatten(ar));
const placeholders = (value: unknown) =>
  [...String(value).matchAll(/{{\s*([\w.]+)[^}]*}}/g)].map(([, name]) => name).sort();

describe("lane bag-pdp copy (I8)", () => {
  it("lazy.json holds exactly the 14 lane keys, in EN and in AR", () => {
    expect([...EN_LAZY.keys()].sort()).toEqual([...LANE_KEYS].sort());
    expect([...AR_LAZY.keys()].sort()).toEqual([...LANE_KEYS].sort());
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
