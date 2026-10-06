import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ENTRY_GZIP_BUDGET_KIB,
  TOTAL_JS_BUDGET_KIB,
  evaluate,
  findEntryScript,
  findModulePreloads,
  isPageScript,
  parseArgs,
  renderReport,
} from "../../scripts/check-bundle-size.mjs";

/*
  P9f — the bundle budget gate fails CLOSED (the pre-P9f script exited 0 on
  `--budget abc`, ignored unknown flags and counted the service worker).
  Repo-wiring test in src/__tests__ (precedent: sdkLink.test.ts). It runs in
  the default jsdom environment ONLY because the global setupFiles
  (src/setupTests.ts) need `window`; it uses nothing from the DOM.
*/

const SCRIPT = join(import.meta.dirname, "../../scripts/check-bundle-size.mjs");
const VITE_HTML = `<script type="module" crossorigin src="/assets/index-A1.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-B2.css">
<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>`;
/** What Vite adds when the entry statically imports split chunks (a vendor group). */
const PRELOAD_HTML = `${VITE_HTML}
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-R1.js">
<link rel="modulepreload" crossorigin href="/assets/vendor-V1.js">`;
const KIB = 1024;

describe("parseArgs (fails closed)", () => {
  it("defaults, then overrides", () => {
    expect(parseArgs([])).toEqual({ total: TOTAL_JS_BUDGET_KIB, entry: ENTRY_GZIP_BUDGET_KIB });
    expect(TOTAL_JS_BUDGET_KIB).toBe(2000);
    expect(ENTRY_GZIP_BUDGET_KIB % 5).toBe(0); // ceil5(measured + 10) — decision 6
    expect(ENTRY_GZIP_BUDGET_KIB).toBe(355); // ceil5(344.4 + 10): a raise needs user approval AND this line
    expect(parseArgs(["--budget", "3000", "--entry-gzip-budget", "400"])).toEqual({ total: 3000, entry: 400 });
  });

  it.each([
    ["--budget", "abc"],
    ["--budget"],
    ["--budget", "0"],
    ["--budget", "-1"],
    ["--budget", "NaN"],
    ["--budget", "Infinity"],
    ["--budget", " "],
    ["--budgte", "3000"],
  ])("rejects %j", (...argv: string[]) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it("rejects a malformed or missing DEFAULT budget too", () => {
    expect(() => parseArgs([], { total: 2000, entry: Infinity })).toThrow(/entry budget/);
    expect(() => parseArgs([], { total: Number("abc"), entry: 355 })).toThrow(/total budget/);
    expect(() => parseArgs([], { total: 2000 } as unknown as { total: number; entry: number })).toThrow(
      /entry budget/
    );
  });
});

describe("findEntryScript", () => {
  it("returns the ONE module script, ignoring the classic registerSW tag", () => {
    expect(findEntryScript(VITE_HTML)).toBe("assets/index-A1.js");
  });

  it("throws on zero or two module scripts", () => {
    expect(() => findEntryScript("<html></html>")).toThrow();
    expect(() => findEntryScript(VITE_HTML + '<script type="module" src="/x.js"></script>')).toThrow();
  });

  it("findModulePreloads returns every modulepreload href, ignoring the stylesheet and manifest links", () => {
    expect(findModulePreloads(VITE_HTML + '<link rel="manifest" href="/manifest.webmanifest">')).toEqual([]);
    expect(findModulePreloads(PRELOAD_HTML)).toEqual(["assets/rolldown-runtime-R1.js", "assets/vendor-V1.js"]);
  });
});

describe("isPageScript / evaluate", () => {
  it("excludes only the ROOT service-worker scripts", () => {
    for (const p of ["sw.js", "workbox-07e28819.js", "firebase-messaging-sw.js"]) expect(isPageScript(p)).toBe(false);
    for (const p of ["assets/index-A1.js", "assets/vendor-x.mjs", "assets/fcmRuntime-x.js", "assets/posthogRuntime-x.js", "registerSW.js", "assets/sw.js"]) {
      expect(isPageScript(p)).toBe(true);
    }
    expect(isPageScript("assets/index-B2.css")).toBe(false);
  });

  it("budgets the entry by gzip and the total by page scripts, inclusive at the limit", () => {
    const files = [
      { path: "assets/index-A1.js", size: 1000 * KIB },
      { path: "assets/lazy.js", size: 1000 * KIB },
      { path: "sw.js", size: 500 * KIB },
    ];
    const entry = { path: "assets/index-A1.js", size: 1000 * KIB, gzip: 360 * KIB };

    const ok = evaluate({ files, entry, budgets: { total: 2000, entry: 360 } });
    expect(ok).toMatchObject({ totalKiB: 2000, entryGzipKiB: 360, entryRawKiB: 1000, totalOk: true, entryOk: true });
    expect(ok.excluded.map((f: { path: string }) => f.path)).toEqual(["sw.js"]);
    expect(evaluate({ files, entry, budgets: { total: 1999, entry: 359 } })).toMatchObject({ totalOk: false, entryOk: false });
    expect(() => evaluate({ files, entry: { ...entry, path: "assets/missing.js" }, budgets: { total: 1, entry: 1 } })).toThrow();
  });

  it("still counts a page script that merely looks like a service worker (assets/sw.js)", () => {
    const files = [
      { path: "assets/index-A1.js", size: 10 * KIB },
      { path: "assets/sw.js", size: 5 * KIB },
      { path: "sw.js", size: 100 * KIB },
      { path: "workbox-07e28819.js", size: 100 * KIB },
      { path: "firebase-messaging-sw.js", size: 100 * KIB },
    ];
    const r = evaluate({ files, entry: { path: "assets/index-A1.js", size: 10 * KIB, gzip: 3 * KIB }, budgets: { total: 15, entry: 3 } });

    expect(r.totalKiB).toBe(15);
    expect(r.totalOk).toBe(true);
    expect(r.page.map((f: { path: string }) => f.path)).toEqual(["assets/index-A1.js", "assets/sw.js"]);
    // The report lists what it did NOT count.
    const report = renderReport(r, { total: 15, entry: 3 });
    expect(report).toContain("Not counted (service worker): `sw.js` 100.0 · `workbox-07e28819.js` 100.0 · `firebase-messaging-sw.js` 100.0");
  });

  it("budgets the modulepreloaded chunks WITH the entry: a small entry plus a vendor split fails", () => {
    const files = [
      { path: "assets/index-A1.js", size: 549 * KIB },
      { path: "assets/vendor-V1.js", size: 961 * KIB },
    ];
    const entry = { path: "assets/index-A1.js", size: 549 * KIB, gzip: 141 * KIB };
    const vendor = { path: "assets/vendor-V1.js", size: 961 * KIB, gzip: 309 * KIB };
    const budgets = { total: 2000, entry: 355 };

    expect(evaluate({ files, entry, budgets }).entryOk).toBe(true); // the entry alone looks fine
    const r = evaluate({ files, entry, preloads: [vendor], budgets });
    expect(r).toMatchObject({ entryGzipKiB: 450, entryRawKiB: 1510, entryOk: false });
    const report = renderReport(r, budgets);
    expect(report).toContain("| Entry `assets/index-A1.js` + 1 modulepreload gzip-9 | 450.0 (raw 1510.0) | 355 | ❌ OVER BUDGET |");
    expect(report).toContain("Boot path gzip-9: `assets/index-A1.js` 141.0 · `assets/vendor-V1.js` 309.0");
    expect(() => evaluate({ files, entry, preloads: [{ ...vendor, path: "sw.js" }], budgets })).toThrow();
  });
});

describe("CLI exit codes", () => {
  const dirs: string[] = [];
  const tempDir = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
  const fixture = (html = VITE_HTML) => {
    const cwd = tempDir("bundle-gate-");
    mkdirSync(join(cwd, "dist/assets"), { recursive: true });
    writeFileSync(join(cwd, "dist/index.html"), html);
    writeFileSync(join(cwd, "dist/assets/index-A1.js"), "export const a = 1;\n".repeat(200));
    writeFileSync(join(cwd, "dist/registerSW.js"), "/* sw */");
    writeFileSync(join(cwd, "dist/sw.js"), "x".repeat(4096));
    return cwd;
  };
  const run = (cwd: string, args: string[] = [], script = SCRIPT) =>
    spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" }).status;

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("passes within budget and fails over it", () => {
    const cwd = fixture();
    expect(run(cwd)).toBe(0);
    expect(run(cwd, ["--entry-gzip-budget", "0.01"])).toBe(1);
    expect(run(cwd, ["--budget", "0.01"])).toBe(1); // the TOTAL verdict fails the CLI too
  });

  it("fails closed on a malformed budget (the pre-P9f script exited 0 here) and without a build", () => {
    expect(run(fixture(), ["--budget", "abc"])).toBe(1);
    expect(run(tempDir("bundle-gate-empty-"))).toBe(1);
  });

  it("fails closed when dist/ has scripts but no index.html (the entry cannot be found)", () => {
    const cwd = fixture();
    rmSync(join(cwd, "dist/index.html"));
    expect(run(cwd)).toBe(1);
  });

  it("measures the entry's modulepreloads too, and fails closed when one is missing", () => {
    const budget = ["--entry-gzip-budget", "32"];
    expect(run(fixture(), budget)).toBe(0); // the entry alone is tiny

    const cwd = fixture(PRELOAD_HTML);
    writeFileSync(join(cwd, "dist/assets/rolldown-runtime-R1.js"), "export {};\n");
    expect(run(cwd, budget)).toBe(1); // vendor-V1.js is listed but missing: cannot measure
    // ~64 KiB gzip-9: incompressible base64 in a comment.
    writeFileSync(join(cwd, "dist/assets/vendor-V1.js"), `/*${randomBytes(64 * KIB).toString("base64")}*/`);
    expect(run(cwd, budget)).toBe(1);
    expect(run(cwd, ["--entry-gzip-budget", "100"])).toBe(0);
  });

  it("still runs when invoked through a symlink (a URL compare skipped main and exited 0)", () => {
    const cwd = fixture();
    symlinkSync(SCRIPT, join(cwd, "linked-gate.mjs"));
    expect(run(cwd, ["--budget", "abc"], join(cwd, "linked-gate.mjs"))).toBe(1);
  });
});
