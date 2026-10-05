#!/usr/bin/env node

/**
 * Bundle Size Check Script
 * Reads dist/ after build and reports total asset sizes.
 * Exits non-zero if JS bundle exceeds the configured budget.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs
 *   node scripts/check-bundle-size.mjs --budget 3000   # 3000 KB budget
 */

import { readdirSync, statSync, writeFileSync } from "fs";
import { join, extname } from "path";

const args = process.argv.slice(2);
const budgetIndex = args.indexOf("--budget");
const JS_BUDGET_KB = budgetIndex !== -1 ? Number(args[budgetIndex + 1]) : 2000; // default 2 MB

const DIST_DIR = join(process.cwd(), "dist");

// ═══════════════════════════════════════════════════════════════════════════
// FILE COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

function collectFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectFiles(fullPath));
      } else {
        const stat = statSync(fullPath);
        files.push({
          path: fullPath.replace(DIST_DIR + "/", ""),
          size: stat.size,
          ext: extname(entry.name).toLowerCase(),
        });
      }
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(
        `\x1b[31m✗ dist/ directory not found. Run "yarn build" first.\x1b[0m\n`,
      );
      process.exit(1);
    }
    throw err;
  }
  return files;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

const files = collectFiles(DIST_DIR);

const categories = {
  js: { ext: [".js", ".mjs"], files: [], totalKB: 0 },
  css: { ext: [".css"], files: [], totalKB: 0 },
  images: {
    ext: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".avif"],
    files: [],
    totalKB: 0,
  },
  fonts: {
    ext: [".woff", ".woff2", ".ttf", ".eot", ".otf"],
    files: [],
    totalKB: 0,
  },
  other: { ext: [], files: [], totalKB: 0 },
};

for (const file of files) {
  let categorized = false;
  for (const [, cat] of Object.entries(categories)) {
    if (cat.ext.includes(file.ext)) {
      cat.files.push(file);
      cat.totalKB += file.size / 1024;
      categorized = true;
      break;
    }
  }
  if (!categorized) {
    categories.other.files.push(file);
    categories.other.totalKB += file.size / 1024;
  }
}

const totalKB = files.reduce((sum, f) => sum + f.size / 1024, 0);

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n========================================");
console.log("  BUNDLE SIZE REPORT");
console.log("========================================\n");

console.log("┌──────────┬──────────┬──────────────────────────┐");
console.log("│ Category │ Size     │ Files                    │");
console.log("├──────────┼──────────┼──────────────────────────┤");

for (const [name, cat] of Object.entries(categories)) {
  if (cat.files.length === 0) continue;
  const sizeStr = `${cat.totalKB.toFixed(1)} KB`.padEnd(8);
  const countStr = `${cat.files.length} files`.padEnd(24);
  console.log(`│ ${name.padEnd(8)} │ ${sizeStr} │ ${countStr} │`);
}

console.log("├──────────┼──────────┼──────────────────────────┤");
console.log(
  `│ TOTAL    │ ${`${totalKB.toFixed(1)} KB`.padEnd(8)} │ ${`${files.length} files`.padEnd(24)} │`,
);
console.log("└──────────┴──────────┴──────────────────────────┘\n");

// Largest JS files
const jsFiles = categories.js.files.sort((a, b) => b.size - a.size);
if (jsFiles.length > 0) {
  console.log("Top 5 largest JS bundles:");
  for (const file of jsFiles.slice(0, 5)) {
    console.log(`  ${(file.size / 1024).toFixed(1)} KB  ${file.path}`);
  }
  console.log();
}

// Budget check
const jsTotalKB = categories.js.totalKB;
console.log("────────────────────────────────────────");
console.log(
  `  JS Budget: ${JS_BUDGET_KB} KB  |  Actual: ${jsTotalKB.toFixed(1)} KB  |  ${jsTotalKB <= JS_BUDGET_KB ? "✓ Within budget" : "✗ OVER BUDGET"}`,
);
console.log("────────────────────────────────────────\n");

// Write markdown summary for GitHub Actions step summary
const summary = [
  "## 📦 Bundle Size Report",
  "",
  "| Category | Size | Files |",
  "|----------|------|-------|",
  ...Object.entries(categories)
    .filter(([, cat]) => cat.files.length > 0)
    .map(
      ([name, cat]) =>
        `| ${name} | ${cat.totalKB.toFixed(1)} KB | ${cat.files.length} |`,
    ),
  `| **TOTAL** | **${totalKB.toFixed(1)} KB** | **${files.length}** |`,
  "",
  `**JS Budget:** ${JS_BUDGET_KB} KB | **Actual:** ${jsTotalKB.toFixed(1)} KB | ${jsTotalKB <= JS_BUDGET_KB ? "✅ Within budget" : "❌ OVER BUDGET"}`,
].join("\n");

writeFileSync("bundle-size-report.md", summary);
console.log("Summary written to bundle-size-report.md\n");

// Exit code
if (jsTotalKB > JS_BUDGET_KB) {
  console.log(
    `\x1b[31m✗ FAILED: JS bundle (${jsTotalKB.toFixed(1)} KB) exceeds budget (${JS_BUDGET_KB} KB).\x1b[0m\n`,
  );
  process.exit(1);
}

console.log("\x1b[32m✓ PASSED: Bundle size within budget.\x1b[0m\n");
process.exit(0);
