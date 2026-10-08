import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  UB3 — the start-screen texture. Figma's plastic_2 (1:2205) is 43 % fully
  transparent and its scratches live in that transparency: P1 flattened it to
  a white JPEG and the scratches were gone (papered over with a soft-light
  blend). The overlay is now a stage-sized WebP WITH alpha. A flattened or
  wrongly sized bitmap fails here, before any screen renders it — and so does
  a stray import of the old JPEG.
*/

const SRC = join(import.meta.dirname, "..");
const OVERLAY = join(SRC, "assets/splash/plastic-overlay.webp");

/** WebP's 24-bit little-endian fields (VP8X canvas size, stored minus one). */
const le24 = (bytes: Buffer, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });

describe("the splash plastic overlay (UB3)", () => {
  const bytes = readFileSync(OVERLAY);

  it("is an extended WebP (RIFF … WEBPVP8X)", () => {
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 16).toString("ascii")).toBe("WEBPVP8X");
    // The RIFF size covers the whole file.
    expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
  });

  it("carries an alpha channel (the VP8X alpha flag) — never flattened", () => {
    expect(bytes[20] & 0x10).toBe(0x10);
  });

  it("is the 1080×1920 stage — Figma's crop and −90° already applied", () => {
    expect(1 + le24(bytes, 24)).toBe(1080);
    expect(1 + le24(bytes, 27)).toBe(1920);
  });

  it("the old flattened JPEG is gone and nothing in src imports it", () => {
    expect(existsSync(join(SRC, "assets/splash/plastic-overlay.jpg"))).toBe(false);
    const importers = sourceFiles(SRC).filter((file) =>
      readFileSync(file, "utf-8").includes("plastic-overlay.jpg")
    );
    expect(importers).toEqual([]);
  });
});
