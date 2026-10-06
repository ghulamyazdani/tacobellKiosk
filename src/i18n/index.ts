import i18n, { type PostProcessorModule } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/translation.json";
import ar from "./locales/ar/translation.json";

/*
 * Unlike posistKiosk's src/i18.ts, this module does NOT read the Redux store —
 * the shell pushes the selected language in via i18n.changeLanguage() (App.tsx),
 * which breaks the i18n→store module cycle the old app carried.
 */

/** The language every session starts in (and resets to — see App.tsx). */
export const DEFAULT_LANGUAGE = "en";

/*
 * Arabic = RTL TEXT, LTR LAYOUT (user decision 2026-10-01). In an RTL
 * language every translated string is wrapped in U+2068 FSI … U+2069 PDI,
 * and so is every interpolated value: each run picks its own direction from
 * its first strong character (dir="auto" per run) inside the unchanged LTR
 * layout — numbers, prices and Latin names inside Arabic stay LTR isolates.
 * Never set `dir` on a container instead: flex rows, grids and `start-*`
 * utilities mirror. English output is byte-identical.
 */
const FSI = "\u2068";
const PDI = "\u2069";
export const isolate = (s: string) => `${FSI}${s}${PDI}`;
/** i18next's dir(undefined) answers "rtl" (sic) — only ask with a real code. */
export const isRtl = (lng?: string) => {
  const code = lng || i18n.language;
  return Boolean(code) && i18n.dir(code) === "rtl";
};

const bidiIsolate: PostProcessorModule = {
  type: "postProcessor",
  name: "bidiIsolate",
  process: (value, _key, options) =>
    typeof value === "string" && isRtl(options?.lng as string | undefined)
      ? isolate(value)
      : value,
};

// Before init: init emits languageChanged synchronously (inline resources).
i18n.on("languageChanged", (lng) => {
  // WCAG 3.1.1 + the Arabic font fallback; DIRECTION deliberately untouched.
  if (typeof document !== "undefined") document.documentElement.lang = lng;
});

i18n
  .use(initReactI18next)
  .use(bidiIsolate)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: ["en", "ar"],
    debug: import.meta.env.DEV,
    postProcess: ["bidiIsolate"],
    // escapeValue:true only to get the hook — React already escapes, so the
    // custom escape replaces HTML escaping. It sees the value, not the call's
    // lng: values follow the ACTIVE language (a getFixedT("ar") call made
    // while EN is active wraps its string, not its values).
    interpolation: {
      escapeValue: true,
      escape: (value: string) => (isRtl() ? isolate(value) : value),
    },
  });

export default i18n;
