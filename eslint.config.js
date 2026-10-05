import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dev-dist",
      "build",
      "coverage",
      "playwright-report",
      "test-results",
      "stats.html",
      ".claude",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Underscore prefix = intentionally unused (interface conformance).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // Kiosk hygiene (CLAUDE.md Rule 3): storage goes through redux-persist /
      // the designated adapters, never ad-hoc. Sites that genuinely need it
      // (the storage adapters themselves) carry a targeted disable + reason.
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message:
            "Use the app's persistence layer (redux-persist manifest / storageSideEffects), not raw localStorage.",
        },
        {
          name: "sessionStorage",
          message: "Use the app's persistence layer, not raw sessionStorage.",
        },
      ],
    },
  }
);
