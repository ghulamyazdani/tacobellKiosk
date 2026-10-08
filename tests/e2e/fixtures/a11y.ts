/**
 * P9f harness — accessibility probes for the flows: axe (WCAG A/AA), 44 px touch targets,
 * untranslated English and un-isolated Arabic. Read-only; they return findings, the spec asserts.
 */
import AxeBuilder from "@axe-core/playwright"; // devDependency 4.13.0, 0 bytes shipped
import { test, type Locator, type Page } from "@playwright/test";
import { locale } from "./backend";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]; // A/AA only: touch kiosk, no keyboard rules
/** A violation the client signed off: `why` cites the PROGRESS open-decisions row. Never a convenience. */
export interface KnownViolation {
  rule: string;
  target: string;
  why: string;
}

/**
 * Whole page (page-level rules check html lang after an AR switch). ONE options() call:
 * options() REPLACES withTags/disableRules in @axe-core/playwright. meta-viewport off = kiosk
 * user-scalable=no (sign-off S3); aria-dialog-name opted in. `incomplete` (textured / gradient /
 * photo backgrounds) is attached, never asserted. NEVER call under a paused page.clock (axe resolves
 * rules with setTimeout(…, 0)); an installed, running clock is fine.
 */
export async function axeSweep(page: Page, label: string, known: KnownViolation[] = []): Promise<string[]> {
  const r = await new AxeBuilder({ page })
    .options({
      runOnly: { type: "tag", values: TAGS },
      rules: { "meta-viewport": { enabled: false }, "aria-dialog-name": { enabled: true } },
    })
    .analyze();
  await test.info().attach(`axe-${label}.json`, {
    body: JSON.stringify(
      { violations: r.violations, incomplete: r.incomplete.map((i) => ({ id: i.id, nodes: i.nodes.map((n) => n.target) })) },
      null,
      2,
    ),
    contentType: "application/json",
  });
  return r.violations
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`))
    .filter((f) => !known.some((k) => f.startsWith(`${k.rule}:`) && f.includes(k.target)));
}

/** Every visible control ≥44×44 design px (stage scale divided out), and no pointer region that is not a control. */
export function targetProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    if (!stage) return ["no kiosk-stage"];
    const k = stage.getBoundingClientRect().height / 1920;
    const CONTROL =
      'button, a[href], [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], input:not([type="hidden"])';
    const name = (el: Element) =>
      el.getAttribute("data-testid") ??
      el.getAttribute("aria-label") ??
      `${el.tagName} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
    const shown = (el: Element) =>
      !el.closest('[aria-hidden="true"], [inert]') && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const out: string[] = [];
    for (const el of stage.querySelectorAll(CONTROL)) {
      const r = el.getBoundingClientRect();
      if (!shown(el) || r.width < 1 || r.height < 1) continue;
      if (r.width / k < 43.5 || r.height / k < 43.5)
        out.push(`${name(el)}: ${Math.round(r.width / k)}×${Math.round(r.height / k)} < 44`);
    }
    for (const el of stage.querySelectorAll("*")) {
      if (getComputedStyle(el).cursor !== "pointer" || !shown(el)) continue;
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") continue;
      if (el.closest(CONTROL)) continue;
      out.push(`${name(el)}: clickable but not a control`);
    }
    return out;
  });
}

/** English UI strings (translation + lazy) a screen must not show while Arabic is on. */
export function englishCopy(): string[] {
  const flat = (o: Record<string, unknown>): string[] =>
    Object.values(o).flatMap((v) => (v && typeof v === "object" ? flat(v as Record<string, unknown>) : [String(v)]));
  const en = locale("en");
  // Templates never match a whole rendered node; "English" is the language's own name in the sheet.
  return [...flat(en), ...flat(locale("en", "lazy"))].filter(
    (s) => !s.includes("{{") && s.trim().length > 1 && s !== en.language.english,
  );
}
/** Visible stage text nodes equal (isolates and marks stripped) to an English UI string. */
export function untranslatedCopy(page: Page, english: string[]): Promise<string[]> {
  return page.evaluate((list) => {
    const strings = new Set(list);
    const stage = document.querySelector('[data-testid="kiosk-stage"]') ?? document.body;
    const out: string[] = [];
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = (n.textContent ?? "").replace(/[\u2066-\u2069\u200e\u200f]/g, "").trim();
      if (!el || !strings.has(text)) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      out.push(`${el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.tagName}: "${text}"`);
    }
    return out;
  }, english);
}
/** Visible Arabic letters outside an isolate (LRI/RLI/FSI…PDI) and outside a direction:rtl element. */
export function arabicNotIsolated(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ARABIC = /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]/;
    const stage = document.querySelector('[data-testid="kiosk-stage"]') ?? document.body;
    const out: string[] = [];
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = n.textContent ?? "";
      if (!el || !ARABIC.test(text) || getComputedStyle(el).direction === "rtl") continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      let depth = 0;
      for (const ch of text) {
        if (ch === "\u2066" || ch === "\u2067" || ch === "\u2068") depth += 1;
        else if (ch === "\u2069") depth = Math.max(0, depth - 1);
        else if (depth === 0 && ARABIC.test(ch)) {
          out.push(`${el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.tagName}: "${text.trim().slice(0, 30)}"`);
          break;
        }
      }
    }
    return out;
  });
}

export interface StageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** ada.spec / menu-scroll.spec stageBox verbatim (STAGE_HEIGHT 1920): a box in stage DESIGN px, to 1px. */
export function stageBox(locator: Locator): Promise<StageBox> {
  return locator.evaluate((el, stageHeight) => {
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    if (!stage) throw new Error("kiosk-stage is not mounted");
    const s = stage.getBoundingClientRect();
    const k = s.height / stageHeight;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round((b.left - s.left) / k),
      y: Math.round((b.top - s.top) / k),
      width: Math.round(b.width / k),
      height: Math.round(b.height / k),
    };
  }, 1920);
}
