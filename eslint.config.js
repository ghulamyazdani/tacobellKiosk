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
  },
  {
    // UB1: the backend's currencySettings is { currency, text, uniDec, uniHex };
    // 17 price sites read an invented `symbol` key and printed bare amounts.
    // One reader resolves the symbol (SDK getCurrencyText); block the next copy.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/hooks/utils/useCurrencySymbol.ts",
      "src/hooks/utils/useAppSettings.ts",
      "src/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@cx-sdk/catalog/state/appSettings.slice",
              importNames: ["selectCurrency"],
              message: "Prices read the symbol through useCurrencySymbol().",
            },
          ],
        },
      ],
    },
  },
  {
    // CLAUDE.md rule 4 (audit-fixes C5): no console in production code — a
    // failure a guest or operator should know about goes to ErrorOccurred
    // (captureKioskEvent), best-effort mirrors swallow theirs. Tests are
    // exempt: spy assertions name console.error.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/__tests__/**"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // Check 8, the bill minimum (user decision 2026-10-14), runs only when
    // the SDK revalidation rule is handed the bill engine. A call without it
    // type-checks and skips the check: the menu TOTAL keeps a reward the bag
    // drops. Tests are exempt: they pin the engine-less verdict.
    // ponytail: a lint stopgap while lane walk-cards-prices still calls
    // without the engine; once it merges, make the SDK parameters required
    // and delete this block.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/__tests__/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='settleCart'][arguments.length<2]",
          message:
            "Pass the bill engine (useBillEngine's getCalculatedBill): without it the bill minimum is never checked.",
        },
        {
          selector:
            "CallExpression[callee.name='shouldDropAppliedOffer'][arguments.length<3]",
          message:
            "Pass { cart, getCalculatedBill } (useBillEngine): without it the bill minimum is never checked.",
        },
      ],
    },
  },
  {
    // e2e: no fixed sleeps — they flake under load and hide the real wait.
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            "wait on state (expect/expect.poll/waitForResponse) or drive time with page.clock",
        },
      ],
    },
  }
);
