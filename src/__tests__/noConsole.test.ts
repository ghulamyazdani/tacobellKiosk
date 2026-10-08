import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  audit-fixes C5 (rulebook Rule 4): no console.* in production code — a
  failure an operator should see goes to ErrorOccurred. ESLint `no-console`
  (src, __tests__ exempt) enforces it at lint time; this pins the tree
  itself, so a disabled rule or an eslint-disable line cannot bring one back
  silently. Comments may NAME console (the history notes do); a call is the
  defect.
*/

const SRC = join(import.meta.dirname, "..");
const isTest = (file: string) =>
  /(^|\/)__tests__\//.test(file) || /\.test\.tsx?$/.test(file) || file === "setupTests.ts";
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("no console in production code (audit-fixes C5)", () => {
  const modules = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.[jt]sx?$/.test(file) && !isTest(file))
    .map((file) => ({ file, source: readFileSync(join(SRC, file), "utf8") }));

  it("no src module outside the tests calls console.*", () => {
    expect(modules.length).toBeGreaterThan(100);
    const calls = modules.flatMap(({ file, source }) =>
      code(source)
        .split("\n")
        .filter((line) => /\bconsole\s*(\?\.|\.)\s*\w+\s*\(|\bconsole\s*\[/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(calls).toEqual([]);
  });

  it("the scan sees a call (and ignores one that is only named in a comment)", () => {
    expect(code('const a = 1;\nconsole.error("x");').split("\n")).toContain('console.error("x");');
    expect(code("// console.log(1)\n/* console.warn(2) */").trim()).toBe("");
  });
});
