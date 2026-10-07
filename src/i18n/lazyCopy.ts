import i18n from "./index";
import en from "./locales/en/lazy.json";
import ar from "./locales/ar/lazy.json";

/*
 * Copy rendered ONLY by lazy chunks (lane bag-pdp; D7 boot budget): the
 * strings ride in the chunk and are merged into the translation namespace
 * when it loads — module evaluation, so before any of its components render.
 * Import this from lazy modules only: a boot-path import puts the strings
 * back on the boot path. Deep merge, never overwrite (a boot key wins — the
 * parity test forbids the overlap). EN ↔ AR parity: src/__tests__/localeParity.
 */
i18n.addResourceBundle("en", "translation", en, true, false);
i18n.addResourceBundle("ar", "translation", ar, true, false);
