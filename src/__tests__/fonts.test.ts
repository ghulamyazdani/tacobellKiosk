import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

/*
  Lane fonts — the self-hosted type is ONE OFL family, Archivo variable
  (wght 100–900 × wdth 62–125, Google Fonts latin + latin-ext), used at three
  widths: body 100 %, .tb-compressed 62 % / 700, .tb-display 125 % / 900.
  P1 shipped a static ExtraCondensed Thin cut under a "Variable" file name and
  every name-based check passed, so the files are DECODED here (WOFF2 table
  directory → brotli → fvar + cmap), never trusted by name. src/index.css is
  parsed as text, like contrast.test.ts.
*/

const SRC = join(import.meta.dirname, "..");
const FONT_DIR = join(SRC, "assets", "fonts");
const CSS = readFileSync(join(SRC, "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const LATIN_EXT = "Archivo-wdth-wght-latin-ext.woff2";
const LATIN = "Archivo-wdth-wght-latin.woff2";
/** ₹ (the India deployment's currency) lives in latin-ext; £ € − … — · × in latin. */
const RUPEE = "U+20B9";
const LATIN_GLYPHS = ["U+00A3", "U+20AC", "U+2212", "U+2026", "U+2014", "U+00B7", "U+00D7"];
const PROBES = [RUPEE, ...LATIN_GLYPHS];
const hex = (u: string) => parseInt(u.slice(2), 16);

const declarations = (body: string): Record<string, string> =>
  Object.fromEntries(
    body
      .split(";")
      .filter((d) => d.trim())
      .map((d) => {
        const colon = d.indexOf(":");
        return [d.slice(0, colon).trim(), d.slice(colon + 1).trim().replace(/\s+/g, " ")];
      })
  );

type Face = Record<string, string> & { file: string };
const FACES: Face[] = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
  const face = declarations(body);
  // ONE url() source (no local(): an OS-installed Archivo may be a static cut), woff2, under ./assets/fonts/.
  const file = /^url\((["']?)\.\/assets\/fonts\/([\w.-]+\.woff2)\1\) format\(["']woff2["']\)$/.exec(face.src)?.[2];
  return { ...face, file: file ?? "" };
});

/** Whether a face's unicode-range covers U+XXXX; a part other than U+X / U+X-Y fails loudly. */
const covers = (face: Face, u: string) =>
  (face["unicode-range"] ?? "U+0-10FFFF").split(",").some((part) => {
    const m = /^U\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim());
    if (!m) throw new Error(`unparsed unicode-range part "${part}"`);
    return parseInt(m[1], 16) <= hex(u) && hex(u) <= parseInt(m[2] ?? m[1], 16);
  });

/** Every `.cls { … }` rule in `css`, parsed. */
const rules = (css: string, cls: string) =>
  [...css.matchAll(new RegExp(String.raw`\.${cls}\s*\{([^}]*)\}`, "g"))].map(([, body]) => declarations(body));
// ponytail: one nesting level (flat rules inside the layer); a brace matcher if the layer ever nests @media.
const COMPONENTS = [...CSS.matchAll(/@layer\s+components\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)]
  .map(([, body]) => body)
  .join("\n");

// WOFF2 known-table index (spec §5.1); flag 63 = a 4-byte tag follows.
const KNOWN_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt fpgm glyf loca prep CFF VORG EBDT EBLC gasp hdmx kern LTSH " +
  "PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG sbix acnt avar bdat bloc " +
  "bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
).split(" ");

/** A WOFF2 file's sfnt tables: 48-byte header, table directory, then ONE brotli stream of every table in order. */
function woff2Tables(path: string): Record<string, Buffer> {
  const woff = readFileSync(path);
  if (woff.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${path} is not WOFF2`);
  let at = 48;
  const uintBase128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = woff[at++];
      value = value * 128 + (byte & 0x7f);
      if (byte < 0x80) return value;
    }
    throw new Error(`${path}: bad UIntBase128`);
  };
  const directory: [tag: string, length: number][] = [];
  for (let n = woff.readUInt16BE(12); n > 0; n--) {
    const flags = woff[at++];
    let tag = KNOWN_TAGS[flags & 63];
    if ((flags & 63) === 63) {
      tag = woff.toString("latin1", at, at + 4);
      at += 4;
    }
    // Transform version: glyf/loca 0 = transformed; every other table 0 = stored as-is.
    const transformed = tag === "glyf" || tag === "loca" ? flags >> 6 === 0 : flags >> 6 !== 0;
    const origLength = uintBase128();
    directory.push([tag, transformed ? uintBase128() : origLength]);
  }
  const stream = brotliDecompressSync(woff.subarray(at, at + woff.readUInt32BE(20)));
  const tables: Record<string, Buffer> = {};
  let offset = 0;
  for (const [tag, length] of directory) {
    tables[tag] = stream.subarray(offset, offset + length);
    offset += length;
  }
  return tables;
}

/** fvar axes as { tag: [min, max] }; {} for a static font. */
function axes(fvar: Buffer | undefined): Record<string, [number, number]> {
  const found: Record<string, [number, number]> = {};
  if (!fvar) return found;
  const first = fvar.readUInt16BE(4);
  const size = fvar.readUInt16BE(10);
  for (let i = 0; i < fvar.readUInt16BE(8); i++) {
    const axis = first + size * i; // tag, min, default, max (16.16 fixed)
    found[fvar.toString("latin1", axis, axis + 4)] = [fvar.readInt32BE(axis + 4) / 65536, fvar.readInt32BE(axis + 12) / 65536];
  }
  return found;
}

/** Code points the cmap maps to a real glyph (format 4 + 12 subtables; glyph 0 = .notdef = missing). */
function codePoints(cmap: Buffer): Set<number> {
  const mapped = new Set<number>();
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const sub = cmap.readUInt32BE(8 + 8 * i);
    const format = cmap.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const start = cmap.readUInt16BE(starts + s);
        const delta = cmap.readInt16BE(deltas + s);
        const rangeOffset = cmap.readUInt16BE(rangeOffsets + s);
        for (let cp = start; cp <= cmap.readUInt16BE(ends + s) && cp !== 0xffff; cp++) {
          const glyph = rangeOffset ? cmap.readUInt16BE(rangeOffsets + s + rangeOffset + 2 * (cp - start)) : cp;
          if (glyph && ((glyph + delta) & 0xffff)) mapped.add(cp);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < cmap.readUInt32BE(sub + 12); g++) {
        const group = sub + 16 + 12 * g;
        for (let cp = cmap.readUInt32BE(group); cp <= cmap.readUInt32BE(group + 4); cp++) mapped.add(cp);
      }
    }
  }
  return mapped;
}

describe("Archivo @font-face rules (src/index.css)", () => {
  it("declares exactly two Archivo faces, latin-ext then latin, each spanning wght 100–900 × wdth 62–125", () => {
    expect(FACES).toMatchObject(
      [LATIN_EXT, LATIN].map((file) => ({
        "font-family": expect.stringMatching(/^(["']?)Archivo\1$/),
        "font-style": "normal",
        "font-weight": "100 900",
        "font-stretch": "62% 125%", // lets font-stretch 62 % / 100 % / 125 % drive the wdth axis on every engine
        "font-display": "swap",
        file,
      }))
    );
  });

  it("₹ U+20B9 is covered by the latin-ext face only; £ € − … — · × by the latin face", () => {
    expect(Object.fromEntries(FACES.map((face) => [face.file, PROBES.filter((u) => covers(face, u))]))).toEqual({
      [LATIN_EXT]: [RUPEE],
      [LATIN]: LATIN_GLYPHS,
    });
  });
});

describe("shipped font files", () => {
  it("every url() target exists and src/assets/fonts holds exactly those files (the P1 cuts are gone)", () => {
    const targets = FACES.map((face) => face.file);
    expect(targets.map((file) => file !== "" && existsSync(join(FONT_DIR, file)))).toEqual(targets.map(() => true));
    expect(new Set(readdirSync(FONT_DIR))).toEqual(new Set(targets));
  });

  it("ships the OFL 1.1 licence text (public/fonts/OFL.txt, copied verbatim into dist)", () => {
    const ofl = readFileSync(join(SRC, "..", "public", "fonts", "OFL.txt"), "utf8");
    expect(ofl).toContain("SIL Open Font License");
    expect(ofl).toContain("Version 1.1");
    expect(ofl).toContain("Copyright 2020 The Archivo Project Authors");
    // The whole licence, not just its header (OFL condition 2): every section, in order, through its last line.
    expect(ofl).toMatch(
      /PREAMBLE[\s\S]+DEFINITIONS[\s\S]+PERMISSION & CONDITIONS[\s\S]+TERMINATION[\s\S]+DISCLAIMER[\s\S]+OTHER DEALINGS IN THE FONT SOFTWARE\.\s*$/
    );
  });

  it.each([LATIN_EXT, LATIN])("%s decodes to a variable font with exactly wght 100–900 × wdth 62–125", (file) => {
    expect(axes(woff2Tables(join(FONT_DIR, file)).fvar)).toEqual({ wght: [100, 900], wdth: [62, 125] });
  });

  it("each face's file has a glyph for every probe its unicode-range claims (₹ in latin-ext; £ € − … in latin)", () => {
    const rendered = FACES.map((face) => {
      const mapped = codePoints(woff2Tables(join(FONT_DIR, face.file)).cmap);
      return [face.file, PROBES.filter((u) => covers(face, u) && mapped.has(hex(u)))];
    });
    expect(Object.fromEntries(rendered)).toEqual({ [LATIN_EXT]: [RUPEE], [LATIN]: LATIN_GLYPHS });
  });
});

describe("one family at three widths", () => {
  it.each([
    ["tb-compressed", "62%", "700"],
    ["tb-display", "125%", "900"],
  ])(".%s is Archivo at %s / %s, uppercase, defined once and inside @layer components", (cls, stretch, weight) => {
    expect(rules(CSS, cls)).toHaveLength(1); // an unlayered copy would beat every Tailwind utility
    expect(rules(COMPONENTS, cls)).toEqual([
      expect.objectContaining({
        "font-family": expect.stringMatching(/^(["']?)Archivo\1,/),
        "font-stretch": stretch,
        "font-weight": weight,
        "text-transform": "uppercase",
      }),
    ]);
  });

  it("one family: --font-sans is defined once and, like every font-family in index.css, leads with Archivo", () => {
    const values = (prop: string) =>
      [...CSS.matchAll(new RegExp(String.raw`(?<=[{;]\s*)${prop}\s*:\s*([^;}]+)`, "g"))].map(([, v]) => v.trim());
    expect(values("--font-sans")).toEqual([expect.stringMatching(/^(["']?)Archivo\1,/)]); // a later @theme copy would win
    expect(values("font-family").filter((stack) => !/^(["']?)Archivo\1(,|$)/.test(stack))).toEqual([]);
  });

  it("no font shorthand or font-variation-settings in index.css (either one overrides what font-stretch / font-weight set)", () => {
    // font-variation-settings beats font-stretch's wdth and font-weight's wght, and inherits (on body it flattens every
    // width); the font shorthand resets stretch, weight and family.
    expect(CSS).not.toMatch(/(?<=[{;]\s*)font(-variation-settings)?\s*:/);
  });

  it("no 'Archivo Condensed' / 'Archivo Expanded' family or P1 file name is left anywhere under src", () => {
    const stale = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(css|html|json|md|svg|tsx?)$/.test(file) && join(SRC, file) !== import.meta.filename)
      .filter((file) => /Archivo[ _-](Condensed|Expanded)|Archivo-Variable/i.test(readFileSync(join(SRC, file), "utf8")));
    expect(stale).toEqual([]);
  });
});
