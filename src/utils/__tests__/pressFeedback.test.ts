import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PREPRESS_MS, installPressFeedback } from "../pressFeedback";

/*
  motion-v2 MV1 — Chromium paints :active on a touch only at GestureShowPress
  (~150 ms held; on a quick tap, after the click), so the pressed fills lagged
  the finger. The listener mirrors a touch press as [data-pressed] at
  touch-down: press STATE, no animation, nothing waits on it. jsdom has no
  layout, so a scroller's overflow is stubbed.
*/

const touch = (type: string, target: EventTarget, { id = 1, primary = true, kind = "touch" } = {}) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, isPrimary: primary, pointerType: kind }));
const el = (id: string) => document.getElementById(id) as HTMLElement;
const pressed = (id: string) => el(id).hasAttribute("data-pressed");
/** A scroller `by` px taller (vertical) or wider (horizontal) than its box. */
const overflow = (id: string, by: number, axis: "y" | "x" = "y") => {
  const [content, box] = axis === "y" ? ["scrollHeight", "clientHeight"] : ["scrollWidth", "clientWidth"];
  Object.defineProperty(el(id), content, { configurable: true, value: 200 + by });
  Object.defineProperty(el(id), box, { configurable: true, value: 200 });
};

let uninstall: () => void;

beforeEach(() => {
  document.body.innerHTML = `
    <button id="a"><span id="a-label">A</span></button>
    <button id="b">B</button>
    <button id="off" disabled>off</button>
    <button id="aria-off" aria-disabled="true">aria off</button>
    <div id="plain">not a button</div>
    <div class="overflow-y-auto" id="list">
      <button id="in-list">in list</button>
      <div class="overflow-x-auto" id="rail"><button id="in-rail">in rail</button></div>
    </div>`;
  uninstall = installPressFeedback();
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("installPressFeedback (motion-v2 MV1): press state at touch-down", () => {
  it("a primary touch on a button — or on its label — marks the button synchronously; that pointer's up clears it", () => {
    touch("pointerdown", el("a-label"));
    expect(pressed("a")).toBe(true);
    expect(el("a-label").hasAttribute("data-pressed")).toBe(false);

    touch("pointerup", document);
    expect(pressed("a")).toBe(false);
  });

  it("that pointer's pointercancel (a pan took the touch, or it slid off) clears it", () => {
    touch("pointerdown", el("a"));
    touch("pointercancel", document);
    expect(pressed("a")).toBe(false);
  });

  it("a second finger neither steals the press nor ends it", () => {
    touch("pointerdown", el("a"));
    touch("pointerdown", el("b"), { id: 2, primary: false });
    expect([pressed("a"), pressed("b")]).toEqual([true, false]);

    touch("pointerup", document, { id: 2 });
    touch("pointercancel", document, { id: 2 });
    expect(pressed("a")).toBe(true);

    touch("pointerup", document);
    expect(pressed("a")).toBe(false);
  });

  it("mouse input (its :active is already instant), a disabled or aria-disabled button and a non-button mark nothing", () => {
    // Each press checked on its own: a press clears the previous mark first, so one check at the end would miss one.
    touch("pointerdown", el("a"), { kind: "mouse" });
    expect(document.querySelectorAll("[data-pressed]"), "mouse").toHaveLength(0);
    for (const id of ["off", "aria-off", "plain"]) {
      touch("pointerdown", el(id), { id: 4 });
      expect(document.querySelectorAll("[data-pressed]"), id).toHaveLength(0);
    }
  });

  it(`where a pan can start (an overflowing scroller) the mark waits ${PREPRESS_MS} ms, and a cancel before then means none`, () => {
    // The contract's 90 ms (Android's prepressed TAP_TIMEOUT is 100 ms): retune it on the panel, here and in M14.
    expect(PREPRESS_MS).toBe(90);
    vi.useFakeTimers();
    overflow("list", 75);

    touch("pointerdown", el("in-list"));
    expect(pressed("in-list")).toBe(false);
    vi.advanceTimersByTime(PREPRESS_MS - 1);
    expect(pressed("in-list")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(pressed("in-list")).toBe(true);
    touch("pointerup", document);
    expect(pressed("in-list")).toBe(false);

    touch("pointerdown", el("in-list"), { id: 3 });
    vi.advanceTimersByTime(60);
    touch("pointercancel", document, { id: 3 }); // the pan began
    vi.advanceTimersByTime(PREPRESS_MS);
    expect(pressed("in-list")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("every scroller around the button counts: a short rail inside an overflowing list still waits", () => {
    vi.useFakeTimers();
    overflow("rail", 0, "x");
    overflow("list", 75);

    touch("pointerdown", el("in-rail"));
    expect(pressed("in-rail")).toBe(false);
    vi.advanceTimersByTime(PREPRESS_MS);
    expect(pressed("in-rail")).toBe(true);
  });

  it("a rail that overflows sideways can pan too: its mark waits", () => {
    vi.useFakeTimers();
    overflow("list", 0);
    overflow("rail", 75, "x");

    touch("pointerdown", el("in-rail"));
    expect(pressed("in-rail")).toBe(false);
    vi.advanceTimersByTime(PREPRESS_MS);
    expect(pressed("in-rail")).toBe(true);
  });

  it("a scroller that fits its content cannot pan: the mark comes at once", () => {
    vi.useFakeTimers();
    overflow("list", 0);
    overflow("rail", 0, "x");

    touch("pointerdown", el("in-list"));
    expect(pressed("in-list")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  // A handler that stops a touch's propagation (a React onPointerUp, say) would hide it from a bubbling
  // document listener and leave the fill stuck on: the listeners run in the capture phase, before any handler.
  it("listens in the capture phase: a handler that stops the touch's propagation never hides it", () => {
    const stop = (event: Event) => event.stopPropagation();
    for (const type of ["pointerdown", "pointerup"]) el("a").addEventListener(type, stop);

    touch("pointerdown", el("a"));
    expect(pressed("a")).toBe(true);
    touch("pointerup", el("a"));
    expect(pressed("a")).toBe(false);
  });

  // Passive: a pan on the long menu never waits for these listeners (none of them cancels a touch).
  it("its listeners are passive: a pan never waits on them", () => {
    uninstall();
    const add = vi.spyOn(document, "addEventListener");
    uninstall = installPressFeedback();
    const calls = add.mock.calls.filter(([type]) => String(type).startsWith("pointer"));
    add.mockRestore();
    expect(calls.map(([type]) => type)).toEqual(["pointerdown", "pointerup", "pointercancel"]);
    for (const [, , options] of calls) expect(options).toMatchObject({ capture: true, passive: true });
  });

  it("a later press moves the mark", () => {
    touch("pointerdown", el("a"));
    touch("pointerdown", el("b"), { id: 2 });
    expect([pressed("a"), pressed("b")]).toEqual([false, true]);
  });

  it("uninstall clears a held mark, cancels a pending one and removes every listener", () => {
    vi.useFakeTimers();
    touch("pointerdown", el("a"));
    uninstall();
    expect(pressed("a")).toBe(false);

    uninstall = installPressFeedback();
    overflow("list", 75);
    touch("pointerdown", el("in-list")); // a pending mark
    uninstall();
    vi.advanceTimersByTime(PREPRESS_MS);
    expect(pressed("in-list")).toBe(false);

    touch("pointerdown", el("b"));
    expect(pressed("b")).toBe(false);
  });

  // motion-v2 review F2: nothing else pinned "press STATE, never motion" — a squeeze driven from press() (an
  // inline button.style.scale, which bypasses the reduced-motion tokens) passed the guardrails, this suite and
  // tsc. The listener may write exactly one thing: the data-pressed attribute.
  it("writes press STATE only: [data-pressed], never a style, a class or an animation API", () => {
    const code = readFileSync(join(import.meta.dirname, "..", "pressFeedback.ts"), "utf8").replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      "",
    );
    expect(code).not.toMatch(/\.style\b|classList|className|setProperty|insertRule|\.animate\(|requestAnimationFrame/);
    const writes = [...code.matchAll(/\.(?:set|remove|toggle)Attribute\(([^,)]*)/g)].map(([, name]) => name.trim());
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes)).toEqual(new Set(['"data-pressed"']));
  });
});
