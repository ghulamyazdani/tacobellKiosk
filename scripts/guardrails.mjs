#!/usr/bin/env node

/**
 * Guardrail Validation Script
 * Scans src/ for patterns that violate kiosk development rules.
 *
 * Usage:
 *   node scripts/guardrails.mjs            # Default: fails only on CRITICAL
 *   node scripts/guardrails.mjs --strict   # Also fails on WARNING violations
 *   node scripts/guardrails.mjs --report   # Writes JSON report to guardrails-report.json
 */

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, relative, extname } from "path";

const args = process.argv.slice(2);
const isStrict = args.includes("--strict");
const shouldReport = args.includes("--report");

const SRC_DIR = join(process.cwd(), "src");
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss"]);

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN DEFINITIONS (line-by-line regex checks)
// ═══════════════════════════════════════════════════════════════════════════
const PATTERNS = [
  // ─── CRITICAL: Kiosk-breaking patterns ───────────────────────────────
  {
    name: "alert() call",
    regex: /\balert\s*\(/g,
    severity: "CRITICAL",
    description: "alert() breaks fullscreen kiosk mode",
    excludeCommented: true,
  },
  {
    name: "confirm() call",
    regex: /\bconfirm\s*\(/g,
    severity: "CRITICAL",
    description: "confirm() breaks fullscreen kiosk mode",
    excludeCommented: true,
  },
  {
    name: "prompt() call",
    regex: /(?<!\.)(?<!\w)prompt\s*\(/g,
    severity: "CRITICAL",
    description: "prompt() breaks fullscreen kiosk mode",
    excludeCommented: true,
  },
  {
    name: "process.exit()",
    regex: /\bprocess\.exit\s*\(/g,
    severity: "CRITICAL",
    description: "process.exit() terminates the kiosk application",
    excludeCommented: true,
  },
  {
    name: "window.close()",
    regex: /\bwindow\.close\s*\(/g,
    severity: "CRITICAL",
    description: "window.close() terminates the kiosk application",
    excludeCommented: true,
  },
  {
    name: "window.open()",
    regex: /\bwindow\.open\s*\(/g,
    severity: "CRITICAL",
    description: "window.open() creates popups that break fullscreen kiosk mode",
    excludeCommented: true,
  },
  {
    name: "eval() / new Function()",
    regex: /\b(?:eval\s*\(|new\s+Function\s*\()/g,
    severity: "CRITICAL",
    description: "eval/Function constructor is a security risk — use safe alternatives",
    excludeCommented: true,
  },
  {
    name: "debugger statement",
    regex: /\bdebugger\b/g,
    severity: "CRITICAL",
    description: "debugger statements freeze the kiosk in production",
    excludeCommented: true,
  },
  {
    name: "dangerouslySetInnerHTML",
    regex: /dangerouslySetInnerHTML/g,
    severity: "CRITICAL",
    description: "dangerouslySetInnerHTML is an XSS risk — use safe rendering",
    excludeCommented: true,
  },
  {
    name: "Non-serializable Redux dispatch",
    regex: /dispatch\s*\(.*payload\s*:\s*(?:new\s+|window\.|document\.)/g,
    severity: "CRITICAL",
    description: "Do not put non-serializable objects (DOM nodes, class instances) in Redux — causes GC bloat",
    excludeCommented: true,
  },

  // ─── WARNING: Stability & architecture patterns ──────────────────────
  {
    name: "window.location manipulation",
    regex: /\bwindow\.location\s*\.\s*(?:href|replace|reload|assign)\s*[=(]/g,
    severity: "WARNING",
    description: "window.location bypasses React Router and breaks kiosk navigation flow",
  },
  {
    name: "console.log/warn/error/debug",
    regex: /\bconsole\.(log|warn|error|debug|info)\s*\(/g,
    severity: "WARNING",
    description: "Use structured logger instead of console methods",
  },
  {
    name: "Direct localStorage access",
    regex: /\b(?:localStorage|window\.localStorage)\s*\.\s*(?:getItem|setItem|removeItem|clear)\b/g,
    severity: "WARNING",
    description: "Use app state management instead of direct localStorage",
  },
  {
    name: "Direct sessionStorage access",
    regex: /\b(?:sessionStorage|window\.sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem|clear)\b/g,
    severity: "WARNING",
    description: "Use app state management instead of direct sessionStorage",
  },
  {
    name: "Direct fetch() call",
    regex: /(?<!\w)fetch\s*\(/g,
    severity: "WARNING",
    description: "Use RTK Query apiSlice instead of direct fetch — ensures error handling, timeouts, retries",
    excludeCommented: true,
  },
  {
    name: "Hardcoded localhost/IP URL",
    regex: /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)/g,
    severity: "WARNING",
    description: "Hardcoded URLs/IPs break across environments — use config/env variables",
    excludeCommented: true,
  },
  {
    name: "@ts-ignore / @ts-nocheck",
    regex: /@ts-(?:ignore|nocheck)/g,
    severity: "WARNING",
    description: "TypeScript suppressions bypass type safety — add proper types instead",
  },
  {
    name: "addEventListener without cleanup risk",
    regex: /\.addEventListener\s*\(/g,
    severity: "WARNING",
    description: "Ensure matching removeEventListener in cleanup — memory leaks crash 24/7 kiosks",
  },
  {
    name: "Unbounded array .push()",
    regex: /\.push\s*\([^)]+\)/g,
    severity: "WARNING",
    description: "Ensure arrays in state have a max length or are cleared on reset — prevents OOM on 24/7 kiosks",
    // Only flag .push() inside Redux slices and state files, not everywhere
    pathFilter: /redux|slice|store|state/i,
  },

  // ─── INFO: Code quality & performance patterns ───────────────────────
  {
    name: ": any type annotation",
    regex: /:\s*any\b/g,
    severity: "INFO",
    description: "Avoid 'any' type — use proper TypeScript types",
  },
  {
    name: "as any type assertion",
    regex: /\bas\s+any\b/g,
    severity: "INFO",
    description: "Avoid 'as any' — use proper type assertions",
  },
  {
    name: "TODO/FIXME/HACK comment",
    regex: /\b(?:TODO|FIXME|HACK|XXX)\b/g,
    severity: "INFO",
    description: "Unresolved tech debt — track and address these",
  },
  {
    name: "!important in styles",
    regex: /!important/g,
    severity: "INFO",
    description: "!important overrides create brittle styling — refactor specificity instead",
    fileExtensions: [".css", ".scss", ".tsx", ".ts"],
  },
  {
    name: "setTimeout/setInterval usage",
    regex: /\b(?:setTimeout|setInterval)\s*\(/g,
    severity: "INFO",
    description: "Ensure timers are cleared on unmount — memory leaks crash 24/7 kiosks",
  },
  {
    name: "Inline arrow function in event prop",
    regex: /<\w+\s+[^>]*\bon(?:Click|Change|Select|Press|Submit|Focus|Blur)\s*=\s*\{\s*\(\s*\)\s*=>/g,
    severity: "INFO",
    description: "Inline arrow functions in JSX props cause re-renders — use useCallback for 24/7 kiosk GC health",
    excludeCommented: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// FILE-LEVEL ANALYZERS (multi-line analysis that can't be done per-line)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyzes useEffect/useLayoutEffect calls for missing cleanup returns.
 * Uses brace-depth tracking to find effect bodies without a return statement.
 */
function analyzeEffectCleanup(filePath, content) {
  const matches = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect useEffect or useLayoutEffect opening
    const effectMatch = line.match(
      /\buse(?:Layout)?Effect\s*\(\s*(?:async\s*)?\(?.*?(?:=>|function)\s*\{?/,
    );
    if (!effectMatch) continue;

    // Skip commented lines
    if (isCommentedLine(line)) continue;

    // Now scan forward through the effect body tracking brace depth
    // to see if there's a cleanup return
    let braceDepth = 0;
    let effectStarted = false;
    let hasCleanupReturn = false;
    let effectBodyEnd = -1;

    // Count opening braces on the effect line itself
    for (const ch of line.slice(effectMatch.index)) {
      if (ch === "{") {
        braceDepth++;
        effectStarted = true;
      }
      if (ch === "}") braceDepth--;
    }

    // If effect is single-line (empty or arrow without braces), skip
    if (effectStarted && braceDepth <= 0) continue;
    if (!effectStarted) {
      // Opening brace might be on next line
      if (i + 1 < lines.length && lines[i + 1].includes("{")) {
        braceDepth = 1;
        effectStarted = true;
      } else {
        continue;
      }
    }

    // Scan forward (max 200 lines to avoid runaway)
    const scanLimit = Math.min(i + 200, lines.length);
    for (let j = i + 1; j < scanLimit; j++) {
      const scanLine = lines[j];

      for (const ch of scanLine) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      // Check for cleanup return pattern at depth 1 (top level of effect body)
      // return () => ... OR return function
      if (braceDepth === 1 || braceDepth === 0) {
        if (/return\s+(?:\(\s*\)\s*=>|function\s*\(|cleanup|clear)/.test(scanLine)) {
          hasCleanupReturn = true;
        }
      }

      // Effect body ended
      if (braceDepth <= 0) {
        effectBodyEnd = j;
        break;
      }
    }

    if (effectStarted && !hasCleanupReturn && effectBodyEnd > i) {
      matches.push({
        file: relative(process.cwd(), filePath),
        line: i + 1,
        column: (effectMatch.index || 0) + 1,
        text: line.trim().substring(0, 100),
      });
    }
  }

  return matches;
}

/**
 * Detects .map() rendering large lists without virtualization.
 * Flags .map() calls that render JSX components in files related to menu/list/category.
 */
function analyzeUnvirtualizedLists(filePath, content) {
  const matches = [];
  const relativePath = relative(SRC_DIR, filePath);

  // Only check files in menu/category/list-related paths
  if (!/menu|category|list|items|grid/i.test(relativePath)) {
    return matches;
  }

  const lines = content.split("\n");
  // Check if file imports a virtualized list component
  const hasVirtualizer =
    /(?:FixedSizeList|VariableSizeList|VirtualizedList|react-window|react-virtualized|FlashList|Virtuoso)/.test(
      content,
    );

  if (hasVirtualizer) return matches;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentedLine(line)) continue;

    // Match .map( that returns JSX (opening < after =>)
    if (/\.map\s*\([^)]*=>\s*[\s(]*</.test(line)) {
      matches.push({
        file: relative(process.cwd(), filePath),
        line: i + 1,
        column: 1,
        text: line.trim().substring(0, 100),
      });
    }
    // Also catch multi-line: .map( on one line, JSX return on next
    if (/\.map\s*\(\s*\(?[^)]*\)?\s*=>\s*\{?\s*$/.test(line)) {
      // Check next few lines for JSX return
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (/^\s*(?:return\s+)?<[A-Z]/.test(lines[j])) {
          matches.push({
            file: relative(process.cwd(), filePath),
            line: i + 1,
            column: 1,
            text: line.trim().substring(0, 100),
          });
          break;
        }
      }
    }
  }

  return matches;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE COLLECTION & SCANNING
// ═══════════════════════════════════════════════════════════════════════════

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "__tests__" ||
        entry.name === "test-utils"
      ) {
        continue;
      }
      files.push(...collectFiles(fullPath));
    } else if (EXTENSIONS.has(extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function isCommentedLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

function scanFile(filePath, pattern) {
  const fileExt = extname(filePath);

  // If pattern specifies fileExtensions, only scan matching files
  if (pattern.fileExtensions && !pattern.fileExtensions.includes(fileExt)) {
    return [];
  }

  // Skip CSS/SCSS files for non-CSS patterns
  if ((fileExt === ".css" || fileExt === ".scss") && !pattern.fileExtensions) {
    return [];
  }

  // Skip test files
  const relativePath = relative(SRC_DIR, filePath);
  if (relativePath.includes(".test.") || relativePath.includes(".spec.")) {
    return [];
  }

  // If pattern has a pathFilter, only scan matching paths
  if (pattern.pathFilter && !pattern.pathFilter.test(relativePath)) {
    return [];
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const matches = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip commented lines for patterns that opt into it
    if (pattern.excludeCommented && isCommentedLine(line)) {
      continue;
    }

    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(line)) !== null) {
      matches.push({
        file: relative(process.cwd(), filePath),
        line: i + 1,
        column: match.index + 1,
        text: line.trim().substring(0, 100),
      });
    }
  }

  return matches;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

const files = collectFiles(SRC_DIR);
const results = {};
let criticalCount = 0;
let warningCount = 0;
let infoCount = 0;

function addResult(name, severity, description, matches) {
  if (matches.length === 0) return;
  results[name] = { severity, description, count: matches.length, matches };
  if (severity === "CRITICAL") criticalCount += matches.length;
  else if (severity === "WARNING") warningCount += matches.length;
  else infoCount += matches.length;
}

// Run line-by-line pattern checks
for (const pattern of PATTERNS) {
  const allMatches = [];
  for (const file of files) {
    const matches = scanFile(file, pattern);
    allMatches.push(...matches);
  }
  addResult(pattern.name, pattern.severity, pattern.description, allMatches);
}

// Run file-level analyzers
const effectCleanupMatches = [];
const unvirtualizedListMatches = [];

for (const file of files) {
  const fileExt = extname(file);
  if (fileExt === ".css" || fileExt === ".scss") continue;

  const relativePath = relative(SRC_DIR, file);
  if (relativePath.includes(".test.") || relativePath.includes(".spec."))
    continue;

  const content = readFileSync(file, "utf-8");

  // Only check .tsx/.ts files for effects (React components/hooks)
  if (fileExt === ".tsx" || fileExt === ".ts") {
    effectCleanupMatches.push(...analyzeEffectCleanup(file, content));
    unvirtualizedListMatches.push(
      ...analyzeUnvirtualizedLists(file, content),
    );
  }
}

addResult(
  "useEffect without cleanup return",
  "WARNING",
  "Kiosk runs 24/7 — effects with timers, listeners, or subscriptions MUST return cleanup functions to prevent memory leaks",
  effectCleanupMatches,
);

addResult(
  "Un-virtualized list rendering (.map)",
  "WARNING",
  "Large .map() rendering in menu/list files causes OOM — use react-window FixedSizeList or similar",
  unvirtualizedListMatches,
);

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n========================================");
console.log("  GUARDRAIL VALIDATION REPORT");
console.log("========================================\n");
console.log(`Files scanned: ${files.length}`);
console.log(`Mode: ${isStrict ? "STRICT" : "DEFAULT"}\n`);

// Summary table
console.log(
  "┌──────────┬──────────────────────────────────────────────┬───────┐",
);
console.log(
  "│ Severity │ Pattern                                      │ Count │",
);
console.log(
  "├──────────┼──────────────────────────────────────────────┼───────┤",
);

for (const [name, data] of Object.entries(results)) {
  const severity = data.severity.padEnd(8);
  const patternName = name.padEnd(44).substring(0, 44);
  const count = String(data.count).padStart(5);
  console.log(`│ ${severity} │ ${patternName} │ ${count} │`);
}

console.log(
  "└──────────┴──────────────────────────────────────────────┴───────┘\n",
);

// Show top violations for CRITICAL
for (const [name, data] of Object.entries(results)) {
  if (data.severity === "CRITICAL" && data.count > 0) {
    console.log(`\x1b[31m✗ CRITICAL: ${name}\x1b[0m — ${data.description}`);
    for (const match of data.matches.slice(0, 10)) {
      console.log(`  ${match.file}:${match.line}  ${match.text}`);
    }
    if (data.matches.length > 10) {
      console.log(`  ... and ${data.matches.length - 10} more`);
    }
    console.log();
  }
}

// Show top violations for WARNING
for (const [name, data] of Object.entries(results)) {
  if (data.severity === "WARNING" && data.count > 0) {
    const icon = isStrict ? "✗" : "⚠";
    const color = isStrict ? "\x1b[31m" : "\x1b[33m";
    console.log(
      `${color}${icon} WARNING: ${name}\x1b[0m — ${data.description} (${data.count} occurrences)`,
    );
    for (const match of data.matches.slice(0, 5)) {
      console.log(`  ${match.file}:${match.line}  ${match.text}`);
    }
    if (data.matches.length > 5) {
      console.log(`  ... and ${data.matches.length - 5} more`);
    }
    console.log();
  }
}

// Show INFO violations (counts only)
for (const [name, data] of Object.entries(results)) {
  if (data.severity === "INFO" && data.count > 0) {
    console.log(
      `\x1b[36mi INFO: ${name}\x1b[0m — ${data.description} (${data.count} occurrences)`,
    );
  }
}
if (infoCount > 0) console.log();

// Summary
console.log("────────────────────────────────────────");
console.log(
  `  CRITICAL: ${criticalCount}  |  WARNING: ${warningCount}  |  INFO: ${infoCount}`,
);
console.log("────────────────────────────────────────\n");

// Write report if requested
if (shouldReport) {
  const report = {
    timestamp: new Date().toISOString(),
    mode: isStrict ? "strict" : "default",
    filesScanned: files.length,
    summary: {
      critical: criticalCount,
      warning: warningCount,
      info: infoCount,
    },
    violations: results,
  };
  writeFileSync("guardrails-report.json", JSON.stringify(report, null, 2));
  console.log("Report written to guardrails-report.json\n");
}

// Exit code
if (criticalCount > 0) {
  console.log(
    "\x1b[31m✗ FAILED: Critical guardrail violations found.\x1b[0m\n",
  );
  process.exit(1);
}

if (isStrict && warningCount > 0) {
  console.log(
    "\x1b[31m✗ FAILED: Warning violations found (strict mode).\x1b[0m\n",
  );
  process.exit(1);
}

console.log(
  "\x1b[32m✓ PASSED: No critical guardrail violations.\x1b[0m\n",
);
process.exit(0);
