import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/translation.json";
import ar from "./locales/ar/translation.json";

/*
 * Unlike posistKiosk's src/i18.ts, this module does NOT read the Redux store —
 * the shell pushes the selected language in via i18n.changeLanguage() (App.tsx),
 * which breaks the i18n→store module cycle the old app carried.
 */
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "ar"],
  debug: import.meta.env.DEV,
  interpolation: { escapeValue: false },
});

export default i18n;
