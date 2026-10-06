#!/usr/bin/env node
/**
 * Bundle budget gate (P9f). Run after `yarn build`; fails CLOSED.
 *
 *   TOTAL  every page-side .js/.mjs under dist/ (entry + lazy chunks)  ≤ TOTAL_JS_BUDGET_KIB
 *   ENTRY  gzip-9 of the boot path dist/index.html loads: its module script
 *          + every <link rel="modulepreload"> chunk (a vendor split)    ≤ ENTRY_GZIP_BUDGET_KIB
 *
 * Service-worker scripts never run in the page and are not counted: sw.js,
 * workbox-*.js, firebase-messaging-sw.js (the FCM relay, P9e) — root level only.
 * KiB = 1024 B (the pre-P9f script printed "KB" for the same unit; 2000 is unchanged).
 *
 * Usage: node scripts/check-bundle-size.mjs [--budget <KiB>] [--entry-gzip-budget <KiB>]
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const TOTAL_JS_BUDGET_KIB = 2000; // user decision 2026-10-05: kept
// Post-P9f entry measured at M = 344.4 KiB gzip-9 (352,659 B, index-BbTbWu-X.js, no modulepreloads; raw
// 1,179.0 KiB) on 2026-10-06, production composition (VITE_POST_HOG_TYPE=production: PostHog a lazy chunk,
// framer-motion removed; pre-P9f 478.2). Budget = ceil5(M + 10). Raise only with user approval.
export const ENTRY_GZIP_BUDGET_KIB = 355;

const FLAGS = { "--budget": "total", "--entry-gzip-budget": "entry" };
const SW_FILE = /^(?:sw\.js|firebase-messaging-sw\.js|workbox-[\w-]+\.js)$/;
const isBudget = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * argv → budgets. Throws on an unknown flag, a missing value, or any budget
 * (flag OR default) that is not a positive finite number.
 */
export function parseArgs(argv, defaults = { total: TOTAL_JS_BUDGET_KIB, entry: ENTRY_GZIP_BUDGET_KIB }) {
  const budgets = { ...defaults };
  for (let i = 0; i < argv.length; i += 2) {
    const key = FLAGS[argv[i]];
    if (!key) throw new Error(`unknown argument "${argv[i]}"`);
    const raw = argv[i + 1] ?? "";
    budgets[key] = raw.trim() === "" ? NaN : Number(raw);
    if (!isBudget(budgets[key])) throw new Error(`${argv[i]} needs a positive number of KiB, got "${raw}"`);
  }
  for (const key of ["total", "entry"]) {
    if (!isBudget(budgets[key])) throw new Error(`the ${key} budget must be a positive number of KiB, got "${budgets[key]}"`);
  }
  return budgets;
}

/** dist-relative posix path of the ONE <script type="module" src> in index.html. Throws unless exactly one. */
export function findEntryScript(indexHtml) {
  const srcs = [...indexHtml.matchAll(/<script\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\btype=["']module["']/.test(tag))
    .map((tag) => tag.match(/\bsrc=["']([^"']+)["']/)?.[1])
    .filter(Boolean);
  if (srcs.length !== 1) throw new Error(`expected exactly 1 module <script src> in dist/index.html, found ${srcs.length}`);
  return srcs[0].replace(/^\.?\//, "");
}

/**
 * dist-relative posix paths of every <link rel="modulepreload" href>: Vite lists the entry's
 * static-import chunks there, so they load at boot and count toward the ENTRY budget.
 * ponytail: trusts Vite's list — `build.modulePreload: false` or a resolveDependencies filter
 * would hide a static-import chunk; walk the chunks' `from"./x.js"` imports if either is ever set.
 */
export function findModulePreloads(indexHtml) {
  return [...indexHtml.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\brel=["']modulepreload["']/.test(tag))
    .map((tag) => tag.match(/\bhref=["']([^"']+)["']/)?.[1])
    .filter(Boolean)
    .map((href) => href.replace(/^\.?\//, ""));
}

export const isPageScript = (path) => /\.m?js$/.test(path) && !SW_FILE.test(path);
export const kib = (bytes) => bytes / 1024;

/** Pure verdict. files: [{ path, size }] (dist-relative posix); entry and each preload: { path, size, gzip }. */
export function evaluate({ files, entry, preloads = /** @type {{ path: string, size: number, gzip: number }[]} */ ([]), budgets }) {
  const page = files.filter((f) => isPageScript(f.path)).sort((a, b) => b.size - a.size);
  const boot = [entry, ...preloads];
  for (const { path } of boot) {
    if (!page.some((f) => f.path === path)) throw new Error(`boot script ${path} is not among dist's page scripts`);
  }
  const sum = (list, key) => list.reduce((total, f) => total + f[key], 0);
  const totalKiB = kib(sum(page, "size"));
  const entryGzipKiB = kib(sum(boot, "gzip"));
  return {
    page,
    boot,
    excluded: files.filter((f) => /\.m?js$/.test(f.path) && !isPageScript(f.path)),
    totalKiB,
    entryRawKiB: kib(sum(boot, "size")),
    entryGzipKiB,
    totalOk: totalKiB <= budgets.total,
    entryOk: entryGzipKiB <= budgets.entry,
  };
}

export function renderReport(r, budgets) {
  const mark = (ok) => (ok ? "✅" : "❌ OVER BUDGET");
  const [entry, ...preloads] = r.boot;
  return [
    "## 📦 Bundle budget (KiB = 1024 B)",
    "",
    "| Budget | Actual | Limit | |",
    "|---|---|---|---|",
    `| Entry \`${entry.path}\`${preloads.length ? ` + ${preloads.length} modulepreload` : ""} gzip-9 | ${r.entryGzipKiB.toFixed(1)} (raw ${r.entryRawKiB.toFixed(1)}) | ${budgets.entry} | ${mark(r.entryOk)} |`,
    `| Total page JS (${r.page.length} files) | ${r.totalKiB.toFixed(1)} | ${budgets.total} | ${mark(r.totalOk)} |`,
    "",
    "Boot path gzip-9: " + r.boot.map((f) => `\`${f.path}\` ${kib(f.gzip).toFixed(1)}`).join(" · "),
    "",
    "Page scripts: " + r.page.map((f) => `\`${f.path}\` ${kib(f.size).toFixed(1)}`).join(" · "),
    "",
    "Not counted (service worker): " + (r.excluded.map((f) => `\`${f.path}\` ${kib(f.size).toFixed(1)}`).join(" · ") || "none"),
  ].join("\n");
}

function walk(dir, root = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full, root);
    return [{ path: relative(root, full).split(sep).join("/"), size: statSync(full).size }];
  });
}

function main() {
  const budgets = parseArgs(process.argv.slice(2));
  const dist = join(process.cwd(), "dist");
  if (!existsSync(dist)) throw new Error('dist/ not found — run "yarn build" first');
  const files = walk(dist);
  const html = readFileSync(join(dist, "index.html"), "utf8");
  // A listed file that is missing throws ENOENT → exit 1 (fail closed).
  const measure = (path) => {
    const bytes = readFileSync(join(dist, path));
    return { path, size: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  };
  const r = evaluate({ files, entry: measure(findEntryScript(html)), preloads: findModulePreloads(html).map(measure), budgets });
  const report = renderReport(r, budgets);
  console.log("\n" + report + "\n");
  writeFileSync("bundle-size-report.md", report + "\n");
  if (!r.totalOk || !r.entryOk) {
    console.error("\x1b[31m✗ FAILED: bundle over budget (see above).\x1b[0m");
    return 1;
  }
  console.log("\x1b[32m✓ PASSED: bundle within budget.\x1b[0m");
  return 0;
}

// realpath on both sides: a symlinked path (macOS /tmp, a linked checkout) must still run the gate —
// a plain URL compare silently skipped main() and exited 0 (fail-open, reproduced in the P9f mapping).
const invokedDirectly = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`\x1b[31m✗ bundle gate error: ${error instanceof Error ? error.message : error}\x1b[0m`);
    process.exitCode = 1; // fail closed: a gate that cannot measure never passes
  }
}
