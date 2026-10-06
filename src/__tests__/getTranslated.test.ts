import { describe, expect, it } from "vitest";
import { getTranslated } from "@cx-sdk/catalog/settings/settingsEngine";

/*
  Post-P9 28 — the SDK resolver useLocalized wraps (the fork's getTranslated).
  Only `ar` translates; every other code returns the plain field. The guard:
  a non-array `aliases` (the SDK type says map, payloads ship a list) falls
  back to `name` instead of throwing inside a render.
*/

const ALIAS = "تشيز برجر";
const EXTRA_NAME = "برجر الجبنة";
const EXTRA_DESCRIPTION = "وصف إضافي";
const UNDERSCORE_DESCRIPTION = "وصف";

const aliases = [
  { value: "Fromage", code: "fr" },
  { value: ALIAS, name: "Arabic", code: "AR", dir: "rtl" },
];

describe("getTranslated — TITLE", () => {
  it("ar: the ar alias wins over name (code compared case-insensitively)", () => {
    expect(getTranslated("ar", { name: "Cheese Burger", aliases }, "TITLE")).toBe(ALIAS);
  });

  it("ar: a non-empty _extra.aliasNameTranslation beats the alias", () => {
    const entity = { name: "Cheese Burger", aliases, _extra: { aliasNameTranslation: EXTRA_NAME } };

    expect(getTranslated("ar", entity, "TITLE")).toBe(EXTRA_NAME);
  });

  it("ar: an empty or null _extra.aliasNameTranslation leaves the alias in charge", () => {
    for (const aliasNameTranslation of ["", null]) {
      const entity = { name: "Cheese Burger", aliases, _extra: { aliasNameTranslation } };
      expect(getTranslated("ar", entity, "TITLE")).toBe(ALIAS);
    }
  });

  it("ar: no ar alias, or a blank alias value → name", () => {
    expect(getTranslated("ar", { name: "Fries", aliases: [{ value: "Frites", code: "fr" }] }, "TITLE")).toBe("Fries");
    expect(getTranslated("ar", { name: "Fries", aliases: [{ value: "", code: "ar" }] }, "TITLE")).toBe("Fries");
    expect(getTranslated("ar", { name: "Fries" }, "TITLE")).toBe("Fries");
  });

  it("en (and any non-ar code) returns name, never the alias", () => {
    const entity = { name: "Cheese Burger", aliases, _extra: { aliasNameTranslation: EXTRA_NAME } };

    expect(getTranslated("en", entity, "TITLE")).toBe("Cheese Burger");
    expect(getTranslated("hi", entity, "TITLE")).toBe("Cheese Burger");
    expect(getTranslated("", entity, "TITLE")).toBe("Cheese Burger");
  });

  it.each<[string, unknown]>([
    ["a map", { ar: { value: ALIAS, code: "ar" } }],
    ["a string", "ar"],
    ["a number", 5],
    ["null", null],
  ])("ar: %s-shaped aliases fall back to name without throwing", (_shape, shaped) => {
    const entity = { name: "Cheese Burger", aliases: shaped };

    expect(() => getTranslated("ar", entity, "TITLE")).not.toThrow();
    expect(getTranslated("ar", entity, "TITLE")).toBe("Cheese Burger");
  });

  it("a null entry inside the list is skipped", () => {
    expect(getTranslated("ar", { name: "Fries", aliases: [null, { value: ALIAS, code: "ar" }] }, "TITLE")).toBe(ALIAS);
  });
});

describe("getTranslated — DESCRIPTION order: extra, then _extra, then description", () => {
  it("ar: extra.descriptionTranslation wins over _extra's", () => {
    const entity = {
      description: "plain",
      extra: { descriptionTranslation: EXTRA_DESCRIPTION },
      _extra: { descriptionTranslation: UNDERSCORE_DESCRIPTION },
    };

    expect(getTranslated("ar", entity, "DESCRIPTION")).toBe(EXTRA_DESCRIPTION);
  });

  it("ar: no extra → _extra.descriptionTranslation", () => {
    const entity = { description: "plain", _extra: { descriptionTranslation: UNDERSCORE_DESCRIPTION } };

    expect(getTranslated("ar", entity, "DESCRIPTION")).toBe(UNDERSCORE_DESCRIPTION);
  });

  it("ar: no translation anywhere → description", () => {
    expect(getTranslated("ar", { description: "plain" }, "DESCRIPTION")).toBe("plain");
    expect(getTranslated("ar", { description: "plain", _extra: { descriptionTranslation: null } }, "DESCRIPTION")).toBe("plain");
  });

  it("ar, fork parity: an `extra` without a translation → description (it never falls through to _extra)", () => {
    const entity = {
      description: "plain",
      extra: {},
      _extra: { descriptionTranslation: UNDERSCORE_DESCRIPTION },
    };

    expect(getTranslated("ar", entity, "DESCRIPTION")).toBe("plain");
  });

  it("en returns description even when a translation exists", () => {
    const entity = { description: "plain", _extra: { descriptionTranslation: UNDERSCORE_DESCRIPTION } };

    expect(getTranslated("en", entity, "DESCRIPTION")).toBe("plain");
  });
});
