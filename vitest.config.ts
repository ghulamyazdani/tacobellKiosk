import { defineConfig } from "vitest/config";

// Deliberately a SEPARATE config from vite.config.ts: none of the Vite plugins
// (PWA, tailwind) should run during unit tests. (Vitest 5's oxc transform uses
// the automatic JSX runtime by default — the old esbuild.jsx workaround from
// posistKiosk is no longer needed; App.test.tsx renders JSX and proves it.)
export default defineConfig({
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "react-redux",
      "@reduxjs/toolkit",
      "redux-persist",
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/setupTests.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.*",
        "src/**/*.spec.*",
        "src/setupTests.ts",
        "src/vite-env.d.ts",
        "src/main.tsx",
      ],
      // Real floors, raised as the app grows — not the 2/5/10/2 placeholders.
      thresholds: { lines: 60, functions: 60, branches: 50, statements: 60 },
    },
  },
});
