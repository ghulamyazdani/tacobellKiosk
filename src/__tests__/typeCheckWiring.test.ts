import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/*
  P9f decision 9 — `yarn type-check` (tsc -b) covers the unit tests and the
  e2e specs (pre-P9f it checked neither). tsconfig.test.json extends the app
  config, whose exclude drops __tests__ / *.test.*: its `"exclude": []` is
  load-bearing, not noise — without it the project silently holds no test.
  Read-only: TypeScript's own config parser, no build, no tsbuildinfo.
*/

const ROOT = join(import.meta.dirname, "../..");

const parse = (config: string) => {
  const parsed = ts.getParsedCommandLineOfConfigFile(join(ROOT, config), undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!parsed) throw new Error(`cannot parse ${config}`);
  return parsed;
};
const rel = (paths: readonly string[]) => paths.map((p) => relative(ROOT, p));
const filesUnder = (dir: string, match: RegExp) =>
  readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .map((file) => join(dir, file))
    .filter((file) => match.test(file));

describe("type-check wiring (P9f)", () => {
  it("tsc -b builds the unit-test and e2e projects", () => {
    const refs = rel((parse("tsconfig.json").projectReferences ?? []).map((r) => r.path));

    expect(refs).toEqual(expect.arrayContaining(["tsconfig.test.json", "tsconfig.e2e.json"]));
  });

  it("every unit test file is in tsconfig.test.json, every e2e file in tsconfig.e2e.json", () => {
    const unit = filesUnder("src", /__tests__\/.*\.tsx?$|\.test\.tsx?$/);
    const e2e = filesUnder("tests/e2e", /\.ts$/);

    expect(unit.length).toBeGreaterThan(80);
    expect(rel(parse("tsconfig.test.json").fileNames)).toEqual(expect.arrayContaining(unit));
    expect(e2e.length).toBeGreaterThan(10);
    expect(rel(parse("tsconfig.e2e.json").fileNames)).toEqual(expect.arrayContaining(e2e));
  });
});
