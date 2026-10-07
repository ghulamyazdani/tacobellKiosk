import type { Page } from "@playwright/test";

/**
 * Lane fonts — the capture specs' DOM-geometry probe (visual-entry and
 * visual-order run it after every shot, soft): what the layout cuts off,
 * measured, not pixels.
 *
 * - a visible text run that a hidden/clip box crops on either axis (up to the
 *   nearest scroll container: scrolled-away text is reachable);
 * - a nowrap run wider than its box;
 * - a button label outside its button;
 * - a label under its option tile's radio/ring (an empty positioned box in the
 *   same button);
 * - a contained photo (object-fit: contain — all of it on show) cut by a
 *   hidden/clip box.
 *
 * Exempt: the ticker marquee, line-clamped or ellipsis text, sr-only labels,
 * anything off the stage, and positioned children (a count badge over a
 * button's edge). A line box tighter than the glyph box (Archivo 1.088 em)
 * lets the glyphs overhang by half the difference. An intended crop must be
 * expressed as line-clamp / ellipsis or a positioned badge.
 */
export async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    if (!stage) return ["no kiosk-stage"];
    const view = stage.getBoundingClientRect();
    const found = new Set<string>();
    const onStage = (r: DOMRect) =>
      r.bottom > view.top && r.top < view.bottom && r.right > view.left && r.left < view.right;
    const visible = (el: Element) =>
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el || el.closest(".tb-marquee-track, .sr-only")) continue;
      if (!visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.some(onStage)) continue;
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      const lineHeight = parseFloat(style.lineHeight) || 1.088 * size;
      const slack = Math.max(0, (1.088 * size - lineHeight) / 2) + 1;
      type Box = { left: number; top: number; right: number; bottom: number };
      const overhangs = (box: Box, x: boolean, y: boolean) =>
        rects.some(
          (r) =>
            (x && (r.left < box.left - 1 || r.right > box.right + 1)) ||
            (y && (r.top < box.top - slack || r.bottom > box.bottom + slack))
        );
      const where = el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.tagName;
      const label = `"${text.slice(0, 40)}" in ${where}`;
      let intended = false;
      for (let box: Element | null = el; box && box !== stage.parentElement; ) {
        const s = getComputedStyle(box);
        if (s.webkitLineClamp !== "none" || s.textOverflow === "ellipsis") {
          intended = true;
          break;
        }
        const x = /hidden|clip/.test(s.overflowX);
        const y = /hidden|clip/.test(s.overflowY);
        if (x || y) {
          const b = box.getBoundingClientRect();
          const left = b.left + box.clientLeft;
          const top = b.top + box.clientTop;
          const right = left + box.clientWidth;
          const inner = { left, top, right, bottom: top + box.clientHeight };
          if (overhangs(inner, x, y)) {
            const cls = box.getAttribute("class") ?? "";
            found.add(`cropped: ${label} by <${box.tagName.toLowerCase()} class="${cls}">`);
            break;
          }
        }
        if (/auto|scroll/.test(`${s.overflowX} ${s.overflowY}`)) break;
        box = box.parentElement;
      }
      if (intended) continue;
      if (/^(nowrap|pre)$/.test(style.whiteSpace)) {
        let block: Element = el;
        while (getComputedStyle(block).display === "inline" && block.parentElement) {
          block = block.parentElement;
        }
        if (overhangs(block.getBoundingClientRect(), true, false)) {
          found.add(`nowrap overflow: ${label}`);
        }
      }
      // A label sits in flow; a positioned child (a count badge) is placed on purpose.
      const button = el.closest("button");
      let badge = false;
      for (let a: Element | null = el; button && a && a !== button; a = a.parentElement) {
        badge ||= /absolute|fixed/.test(getComputedStyle(a).position);
      }
      if (button && !badge && overhangs(button.getBoundingClientRect(), true, true)) {
        found.add(`outside its button: ${label}`);
      }
      // An option tile's radio/ring: an empty positioned box in the same button.
      for (const mark of button?.querySelectorAll("span:empty") ?? []) {
        const m = mark.getBoundingClientRect();
        const hit = rects.some(
          (r) => r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top
        );
        if (hit && getComputedStyle(mark).position === "absolute") {
          found.add(`under its radio: ${label}`);
        }
      }
    }
    // A contained photo (object-fit: contain — all of it on show) that a
    // hidden/clip box cuts, up to the nearest scroll container.
    for (const img of stage.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      if (getComputedStyle(img).objectFit !== "contain" || r.width < 1 || !onStage(r)) continue;
      if (!visible(img)) continue;
      for (let box = img.parentElement; box && box !== stage.parentElement; box = box.parentElement) {
        const s = getComputedStyle(box);
        const x = /hidden|clip/.test(s.overflowX);
        const y = /hidden|clip/.test(s.overflowY);
        if (x || y) {
          const b = box.getBoundingClientRect();
          const left = b.left + box.clientLeft;
          const top = b.top + box.clientTop;
          if (
            (x && (r.left < left - 1 || r.right > left + box.clientWidth + 1)) ||
            (y && (r.top < top - 1 || r.bottom > top + box.clientHeight + 1))
          ) {
            const where = img.closest("[data-testid]")?.getAttribute("data-testid") ?? "IMG";
            found.add(`photo cropped: in ${where} by <${box.tagName.toLowerCase()} class="${box.getAttribute("class") ?? ""}">`);
          }
          break;
        }
        if (/auto|scroll/.test(`${s.overflowX} ${s.overflowY}`)) break;
      }
    }
    return [...found];
  });
}
