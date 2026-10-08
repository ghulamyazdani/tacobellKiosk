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

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

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

  it("main.tsx: installChunkErrorRecovery < setChunkFailureHealer < setAnalyticsPort < startAnalytics < createRoot", () => {
    const main = stripComments(readFileSync(join(SRC, "main.tsx"), "utf8"));
    const at = (call: RegExp) => {
      const index = main.search(call);
      expect(index, call.source).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      at(/^installChunkErrorRecovery\(\)/m),
      at(/^setChunkFailureHealer\(/m),
      at(/^setAnalyticsPort\(/m),
      at(/^(?:void\s+)?startAnalytics\(\)/m),
      at(/^createRoot\(/m),
    ];

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  /*
    Lane figma-polish G2(a): chunk recovery installs FIRST — before the store
    exists — and the store-backed healer is registered right after it, as the
    whole-app update the splash applies at its next dwell.
  */
  it("main.tsx: the first two boot statements are install, then the healer (the whole-app update)", () => {
    const statements = stripComments(readFileSync(join(SRC, "main.tsx"), "utf8"))
      .split("\n")
      .filter((line) => /^\S/.test(line) && !/^(?:import\b|\}|\)|from\b)/.test(line));

    expect(statements[0]).toBe("installChunkErrorRecovery();");
    expect(statements[1]).toBe("setChunkFailureHealer(() => store.dispatch(initiateWholeAppUpdate()));");
  });

  /*
    audit-fixes B3: pageRefreshed fires ONCE per page load, from main.tsx's
    module body — right after startAnalytics (so it is queued behind the
    load, in order) and before the first render; never from a component
    (a remount would report another "refresh").
  */
  it("main.tsx: pageRefreshed is the statement right after startAnalytics, before createRoot — and nothing else sends it", () => {
    const main = stripComments(readFileSync(join(SRC, "main.tsx"), "utf8"));
    const statements = main
      .split("\n")
      .filter((line) => /^\S/.test(line) && !/^(?:import\b|\}|\)|from\b)/.test(line));
    const start = statements.findIndex((line) => /^(?:void\s+)?startAnalytics\(\)/.test(line));

    expect(start).toBeGreaterThan(-1);
    expect(statements[start + 1]).toBe("captureKioskEvent(KioskEventName.pageRefreshed, {");
    expect(main.indexOf("KioskEventName.pageRefreshed")).toBeLessThan(main.search(/^createRoot\(/m));
    const otherSenders = sources
      .filter(({ file }) => file !== "main.tsx" && !/(^|\/)__tests__\/|\.test\.tsx?$/.test(file))
      .filter(({ source }) => /KioskEventName\.pageRefreshed/.test(stripComments(source)))
      .map(({ file }) => file);
    expect(otherSenders).toEqual([]);
  });

  // audit-fixes C5: its failures go to ErrorOccurred (no console), so its ONE
  // import is the analytics adapter — module state only, nothing lazy at
  // evaluation (startAnalytics' import() runs when main.tsx calls it).
  it("chunkRecovery.ts imports only the analytics adapter (no other import, no import() or require) — it runs before the store exists", () => {
    const recovery = stripComments(readFileSync(join(SRC, "utils/chunkRecovery.ts"), "utf8"));

    expect(recovery.match(/^[ \t]*import\b.*$/gm)).toEqual([
      'import { captureKioskEvent, KioskEventName } from "./analytics";',
    ]);
    expect(recovery).not.toMatch(/\bimport\s*\(/);
    expect(recovery).not.toMatch(/\brequire\s*\(/);
    expect(recovery).not.toMatch(/^\s*export\b[^;]*\bfrom\b/m);
    expect(recovery).toMatch(/export const setChunkFailureHealer\b/);
    // The adapter's barrel only re-exports; its import() lives in a function.
    const barrel = stripComments(readFileSync(join(SRC, "utils/analytics/index.ts"), "utf8"));
    expect(barrel.replace(/^\s*export\b[^;]*;\s*/gm, "").trim()).toBe("");
    const adapter = stripComments(readFileSync(join(SRC, "utils/analytics/trackEvent.ts"), "utf8"));
    expect(adapter.match(/\bimport\s*\(/g)).toHaveLength(1);
    expect(adapter).toMatch(/export async function startAnalytics\(\)[\s\S]*\bimport\s*\(\s*"\.\/posthogRuntime"\s*\)/);
  });
});

/*
  Lane figma-polish item 42: the tier-2 CUSTOMIZE page and the SDK tier2Logic
  only it uses ride in the ONE lazy UI chunk (bagLazyParts) — a static import
  anywhere else puts them back on the boot path, and a direct import() would
  mint a second lazy chunk (Rolldown then splits the boot path).
*/
describe("the tier-2 page stays in the lazy UI chunk (item 42)", () => {
  const app = sources.filter(({ file }) => !/(^|\/)__tests__\/|\.test\.tsx?$/.test(file));
  /** App files with a STATIC value import / re-export of a module whose specifier matches `spec`. */
  const staticImporters = (spec: string) => {
    const quoted = `["'](?:${spec})["']`;
    const statement = new RegExp(
      `(?:^|\\n)\\s*(import|export)\\b([^;]*?)\\bfrom\\s*${quoted}|(?:^|\\n)\\s*import\\s*${quoted}`,
      "g"
    );
    return app
      .filter(({ source }) =>
        [...source.matchAll(statement)].some(([, , clause]) => !/^\s*type\b/.test(clause ?? ""))
      )
      .map(({ file }) => file);
  };
  const dynamicImporters = (spec: string) =>
    app.filter(({ source }) => new RegExp(`\\bimport\\(\\s*["'](?:${spec})["']`).test(source)).map(({ file }) => file);

  const TIER2_PAGE = `[^"']*/Tier2CustomizationSheet(?:\\.tsx)?`;
  const TIER2_LOGIC = "@cx-sdk/ordering/customization/tier2Logic";
  const CHUNK = `[^"']*/bagLazyParts(?:\\.ts)?`;

  it("only bagLazyParts statically imports Tier2CustomizationSheet (type-only imports allowed), and nothing import()s it directly", () => {
    expect(app.length).toBeGreaterThan(100);
    expect(staticImporters(TIER2_PAGE)).toEqual(["components/cart/bagLazyParts.ts"]);
    expect(dynamicImporters(TIER2_PAGE)).toEqual([]);
  });

  it("only the tier-2 page imports the SDK tier2Logic", () => {
    expect(staticImporters(TIER2_LOGIC)).toEqual(["components/customization/Tier2CustomizationSheet.tsx"]);
    expect(dynamicImporters(TIER2_LOGIC)).toEqual([]);
  });

  it("bagLazyParts itself is only ever import()ed (a static import would pull the whole chunk onto the boot path)", () => {
    expect(staticImporters(CHUNK)).toEqual([]);
    expect(dynamicImporters(CHUNK).length).toBeGreaterThanOrEqual(3);
    expect(dynamicImporters(CHUNK)).toContain("pages/Customization/loadPdpLazyParts.ts");
  });
});
