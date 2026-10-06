import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
  P9f boot-bundle guards (repo-wiring, sdkLink.test precedent). posthog-js is
  a lazy chunk: ONE seam imports it (posthogRuntime.ts, the chunk name that
  chunkRecovery exempts) — a static import anywhere else drags ~280 KiB back
  onto the boot path. framer-motion is gone (pure-CSS motion). main.tsx keeps
  CLAUDE.md rule 8's boot order.
*/

const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");
const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => ({ file, source: readFileSync(join(SRC, file), "utf8") }));

/** Files with a VALUE import/re-export/import()/require of `pkg` (or a subpath); `import type`/`export type` are erased. */
const valueImporters = (pkg: string) => {
  const spec = `["']${pkg}(?:/[^"']*)?["']`;
  const statement = new RegExp(`(?:^|\\n)\\s*(import|export)\\b([^;]*?)\\bfrom\\s*${spec}|\\bimport\\s*(?:${spec}|\\(\\s*${spec})|\\brequire\\(\\s*${spec}`, "g");
  return sources
    .filter(({ source }) =>
      [...source.matchAll(statement)].some(([, , clause]) => !/^\s*type\b/.test(clause ?? ""))
    )
    .map(({ file }) => file);
};

describe("boot-bundle guards (P9f)", () => {
  it("only src/utils/analytics/posthogRuntime.ts imports posthog-js (type-only imports allowed)", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(valueImporters("posthog-js")).toEqual(["utils/analytics/posthogRuntime.ts"]);
  });

  it("nothing imports framer-motion, and it is not a dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string>>;

    expect(valueImporters("framer-motion")).toEqual([]);
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty(["framer-motion"]);
  });

  it("main.tsx: installChunkErrorRecovery < setAnalyticsPort < startAnalytics < createRoot", () => {
    const main = readFileSync(join(SRC, "main.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const at = (call: RegExp) => {
      const index = main.search(call);
      expect(index, call.source).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      at(/^installChunkErrorRecovery\(\)/m),
      at(/^setAnalyticsPort\(/m),
      at(/^(?:void\s+)?startAnalytics\(\)/m),
      at(/^createRoot\(/m),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
