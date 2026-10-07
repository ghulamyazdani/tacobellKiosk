import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import i18n from "..";
import en from "../locales/en/translation.json";
import ar from "../locales/ar/translation.json";
import enLazy from "../locales/en/lazy.json";
import arLazy from "../locales/ar/lazy.json";
import "../lazyCopy";

/*
  P9f — Arabic is RTL TEXT inside the LTR layout: in AR every translated
  string and every interpolated value is a U+2068 FSI … U+2069 PDI isolate,
  and <html lang> follows the language. English must stay byte-identical.
  The real singleton, so this pins exactly what the screens render.
*/

const FSI = "\u2068";
const PDI = "\u2069";
const ISOLATES = /[\u2066-\u2069]/;
const ARABIC = /\p{Script=Arabic}/u;
const PLACEHOLDER = /{{\s*([\w.]+)[^}]*}}/g;

/** "a.b.c" → value, for every leaf. */
const flatten = (node: unknown, prefix = ""): Array<[string, string]> =>
  node !== null && typeof node === "object"
    ? Object.entries(node).flatMap(([key, value]) =>
        flatten(value, prefix ? `${prefix}.${key}` : key)
      )
    : [[prefix, String(node)]];

/** Every {{placeholder}} of `raw` set to "1". */
const optionsFor = (raw: string) =>
  Object.fromEntries([...raw.matchAll(PLACEHOLDER)].map(([, name]) => [name, "1"]));
const filled = (raw: string) => raw.replace(PLACEHOLDER, "1");
const strip = (s: string) => s.replace(/[\u2068\u2069]/g, "");

describe("bidi isolates (RTL text, LTR layout)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("EN: every key renders byte-identical to its copy — no isolate anywhere", () => {
    // lazy.json: the copy lazy chunks register (i18n/lazyCopy) — same rules.
    const changed = [...flatten(en), ...flatten(enLazy)]
      .filter(([key, raw]) => {
        const out = i18n.t(key, optionsFor(raw));
        return out !== filled(raw) || ISOLATES.test(out);
      })
      .map(([key]) => key);

    expect(changed).toEqual([]);
    // escapeValue is on only for the hook: values are never HTML-escaped.
    expect(i18n.t("loading.retryIn", { seconds: "<1 & 'x'>" })).toBe(
      "Trying again in <1 & 'x'>s"
    );
  });

  it("AR: every key is one isolate around its copy", async () => {
    await i18n.changeLanguage("ar");

    const wrong = [...flatten(ar), ...flatten(arLazy)]
      .filter(([key, raw]) => {
        const out = i18n.t(key, optionsFor(raw));
        return !out.startsWith(FSI) || !out.endsWith(PDI) || strip(out) !== filled(raw);
      })
      .map(([key]) => key);

    expect(wrong).toEqual([]);
  });

  it("isolates interpolated values in AR only", async () => {
    expect(i18n.t("loading.retryIn", { seconds: 10 })).toBe("Trying again in 10s");

    await i18n.changeLanguage("ar");

    expect(i18n.t("loading.retryIn", { seconds: 10 })).toContain(`${FSI}10${PDI}`);
  });

  it("AR bag.lineQty has no Arabic letter, so its isolate resolves LTR", async () => {
    await i18n.changeLanguage("ar");

    const line = i18n.t("bag.lineQty", { qty: 2 });
    expect(line.startsWith(FSI)).toBe(true);
    expect(strip(line)).toBe("2 ×");
    expect(strip(line)).not.toMatch(ARABIC);
  });

  it("<html lang> follows the language; <html dir> is never set", async () => {
    await i18n.changeLanguage("ar");
    expect(document.documentElement.lang).toBe("ar");
    // Decision 1: direction untouched — an <html dir> mirrors every flex row and start-* utility.
    expect(document.documentElement).not.toHaveAttribute("dir");

    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("getFixedT('ar') is wrapped while EN is active", () => {
    expect(i18n.language).toBe("en");

    expect(i18n.getFixedT("ar")("ada.exit")).toBe(`${FSI}${ar.ada.exit}${PDI}`);
    expect(i18n.t("ada.exit")).toBe(en.ada.exit);
  });

  it("a missing key in AR is wrapped and resolves LTR (first strong, not RLI)", async () => {
    await i18n.changeLanguage("ar");

    const out = i18n.t("bidi.noSuchKey");
    expect(out).toBe(`${FSI}bidi.noSuchKey${PDI}`);
    expect(out).not.toMatch(ARABIC);
  });

  it("returnObjects yields an object of wrapped leaves and never throws", async () => {
    expect(i18n.t("idle", { returnObjects: true })).toEqual(en.idle);

    await i18n.changeLanguage("ar");

    expect(i18n.t("idle", { returnObjects: true })).toEqual(
      Object.fromEntries(
        Object.entries(ar.idle).map(([key, raw]) => [key, `${FSI}${raw}${PDI}`])
      )
    );
  });

  it("isRtl never asks dir() without a code: with no language resolved (pre-init) English stays bare", () => {
    const saved = {
      language: i18n.language,
      languages: i18n.languages,
      resolvedLanguage: i18n.resolvedLanguage,
    };
    Object.assign(i18n, { language: undefined, languages: undefined, resolvedLanguage: undefined });
    try {
      expect(i18n.dir()).toBe("rtl"); // the i18next quirk the guard exists for
      expect(i18n.t("loading.retryIn", { seconds: 10 })).toBe("Trying again in 10s");
    } finally {
      Object.assign(i18n, saved);
    }
  });
});

/*
  Rendered AR copy carries the isolates, so an exact matcher against literal
  Arabic (or the raw AR resource) can never pass again. Grep-style: the first
  argument list of every exact matcher / exact query anywhere under src.
  ponytail: copy routed through a variable is invisible to it; walk the AST
  (typescript is installed) if that ever slips through.
*/
describe("no exact matcher compares literal Arabic", () => {
  const SRC = join(import.meta.dirname, "../..");
  const EXACT =
    /\b(?:toBe|toEqual|toStrictEqual|toHaveAccessibleName|toHaveAccessibleDescription|toHaveAttribute|toHaveValue|toHaveDisplayValue|toHaveFormValues|(?:get|query|find)(?:All)?By(?:Role|Text|LabelText|PlaceholderText|DisplayValue|AltText|Title))\(([^)]*)\)/g;
  const RAW_AR = /\p{Script=Arabic}|getResource\(\s*["']ar["']/u;

  it("assert AR copy through i18n.t() or a substring matcher instead", () => {
    const offenders = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(join(SRC, file), "utf8");
        return [...source.matchAll(EXACT)]
          .filter(([, args]) => RAW_AR.test(args) && !/exact:\s*false/.test(args))
          .map(({ index }) => `${file}:${source.slice(0, index).split("\n").length}`);
      });

    expect(offenders).toEqual([]);
  });
});
