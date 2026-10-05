#!/usr/bin/env node

/**
 * Dependency Validation Script
 * Checks package.json dependencies against safety rules.
 *
 * Flags:
 *   - Wildcard (*) or git-URL version specifiers
 *   - Known deprecated packages
 *   - Packages with known security concerns
 *
 * Usage:
 *   node scripts/check-dependencies.mjs
 *   node scripts/check-dependencies.mjs --report   # Writes JSON report
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const shouldReport = args.includes("--report");

const PKG_PATH = join(process.cwd(), "package.json");

// ═══════════════════════════════════════════════════════════════════════════
// RULES
// ═══════════════════════════════════════════════════════════════════════════

/** Packages known to be deprecated or risky */
const DEPRECATED_PACKAGES = new Set([
  "request",
  "node-uuid",
  "nomnom",
  "native-base", // known issues in kiosk context
  "moment", // prefer dayjs (already used)
  "left-pad",
  "event-stream",
  "flatmap-stream",
  "ua-parser-js", // had supply-chain attack
]);

/** Packages that should only be in devDependencies, not dependencies */
const DEV_ONLY_PACKAGES = new Set([
  "eslint",
  "prettier",
  "typescript",
  "@types/react",
  "@types/react-dom",
  "@types/lodash",
  "@vitejs/plugin-react",
  "vite",
  "vitest",
  "jsdom",
  "@testing-library/react",
  "@testing-library/dom",
  "@testing-library/jest-dom",
  "@testing-library/user-event",
  "@playwright/test",
  "tailwindcss",
  "postcss",
  "autoprefixer",
  "sharp",
]);

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
const deps = pkg.dependencies || {};
const devDeps = pkg.devDependencies || {};

const issues = [];

function checkDeps(depMap, section) {
  for (const [name, version] of Object.entries(depMap)) {
    // Wildcard version
    if (version === "*" || version === "latest") {
      issues.push({
        package: name,
        section,
        severity: "CRITICAL",
        reason: `Version "${version}" is unpinned — use a specific semver range`,
      });
    }

    // Git URL versions
    if (
      /^(git|github|https?:\/\/)/.test(version) ||
      version.includes("github.com")
    ) {
      issues.push({
        package: name,
        section,
        severity: "WARNING",
        reason: `Git/URL dependency "${version}" — pin to a published npm version`,
      });
    }

    // Deprecated packages
    if (DEPRECATED_PACKAGES.has(name)) {
      issues.push({
        package: name,
        section,
        severity: "WARNING",
        reason: `Package "${name}" is deprecated or has known issues — consider alternatives`,
      });
    }

    // Dev-only package in production dependencies
    if (section === "dependencies" && DEV_ONLY_PACKAGES.has(name)) {
      issues.push({
        package: name,
        section,
        severity: "WARNING",
        reason: `"${name}" should be in devDependencies, not dependencies — inflates production bundle`,
      });
    }
  }
}

checkDeps(deps, "dependencies");
checkDeps(devDeps, "devDependencies");

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n========================================");
console.log("  DEPENDENCY VALIDATION REPORT");
console.log("========================================\n");
console.log(`Total dependencies: ${Object.keys(deps).length}`);
console.log(`Total devDependencies: ${Object.keys(devDeps).length}\n`);

const criticals = issues.filter((i) => i.severity === "CRITICAL");
const warnings = issues.filter((i) => i.severity === "WARNING");

if (issues.length === 0) {
  console.log("\x1b[32m✓ All dependencies look good.\x1b[0m\n");
} else {
  for (const issue of criticals) {
    console.log(
      `\x1b[31m✗ CRITICAL [${issue.section}] ${issue.package}\x1b[0m`,
    );
    console.log(`  ${issue.reason}\n`);
  }

  for (const issue of warnings) {
    console.log(
      `\x1b[33m⚠ WARNING [${issue.section}] ${issue.package}\x1b[0m`,
    );
    console.log(`  ${issue.reason}\n`);
  }

  console.log("────────────────────────────────────────");
  console.log(
    `  CRITICAL: ${criticals.length}  |  WARNING: ${warnings.length}`,
  );
  console.log("────────────────────────────────────────\n");
}

// Write report if requested
if (shouldReport) {
  const report = {
    timestamp: new Date().toISOString(),
    totalDependencies: Object.keys(deps).length,
    totalDevDependencies: Object.keys(devDeps).length,
    issues,
    summary: {
      critical: criticals.length,
      warning: warnings.length,
    },
  };
  writeFileSync("dependency-report.json", JSON.stringify(report, null, 2));
  console.log("Report written to dependency-report.json\n");
}

// Exit code — fail on CRITICAL only
if (criticals.length > 0) {
  console.log("\x1b[31m✗ FAILED: Critical dependency issues found.\x1b[0m\n");
  process.exit(1);
}

console.log("\x1b[32m✓ PASSED: No critical dependency issues.\x1b[0m\n");
process.exit(0);
