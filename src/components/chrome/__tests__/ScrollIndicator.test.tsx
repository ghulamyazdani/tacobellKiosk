import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, useRef } from "react";
import ScrollIndicator from "../ScrollIndicator";

/*
  Post-P9 26 — the Figma 1:5263 scroll bar. The TRACK is still the D3
  indicator node (aria-hidden + pointer-events-none, pinned by the page
  tests); since the user's 2026-10-08 request a transparent sibling HIT
  STRIP makes the bar draggable (second describe). No React state:
  visibility, size, position and the drag are DOM writes through refs,
  repainted by the pane's scroll event, a ResizeObserver on the pane and each
  direct child, and a childList MutationObserver. jsdom has no layout, so
  each test backs the pane's three scroll metrics itself and captures the RO
  callback.
*/

interface Metrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

/** Instance-level scroll metrics on the pane (never on the prototype). */
const withMetrics = (el: HTMLElement, initial: Metrics) => {
  const m = { ...initial };
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => m.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => m.clientHeight });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => m.scrollTop,
    set: (v: number) => {
      m.scrollTop = v;
    },
  });
  return m;
};

const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  readonly observed = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: () => void) {
    observers.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
    this.disconnected = true;
  }
}

let metrics: Metrics;
let paneEl: HTMLDivElement | null = null;

function Harness({ height = 790, top = 505, init }: { height?: number; top?: number; init: Metrics }) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div>
      <div
        data-testid="pane"
        ref={(el) => {
          ref.current = el;
          if (el && el !== paneEl) {
            paneEl = el;
            metrics = withMetrics(el, init);
          }
        }}
      >
        <section>first</section>
        <section>second</section>
      </div>
      <ScrollIndicator target={ref} top={top} height={height} testId="bar" />
    </div>
  );
}

const trackEl = () => screen.getByTestId("bar");
const thumbEl = () => screen.getByTestId("bar-thumb");
const pane = () => paneEl as HTMLDivElement;
const scrollTo = (top: number) =>
  act(() => {
    metrics.scrollTop = top;
    pane().dispatchEvent(new Event("scroll"));
  });

// setupTests defines window.ResizeObserver as writable but NOT configurable,
// so vi.stubGlobal cannot redefine it: assign and restore by hand.
type ObserverGlobals = { ResizeObserver: unknown; MutationObserver: unknown };
const globals = window as unknown as ObserverGlobals;
const original: ObserverGlobals = {
  ResizeObserver: globals.ResizeObserver,
  MutationObserver: globals.MutationObserver,
};

beforeEach(() => {
  observers.length = 0;
  paneEl = null;
  globals.ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
  Object.assign(globals, original);
  vi.restoreAllMocks();
});

describe("ScrollIndicator (Figma 1:5263, indicator only)", () => {
  it("is aria-hidden and pointer-events-none, at the given top/height, with an inline-only thumb transform", () => {
    render(<Harness init={{ scrollHeight: 1580, clientHeight: 790, scrollTop: 0 }} />);

    expect(trackEl()).toHaveAttribute("aria-hidden", "true");
    expect(trackEl()).toHaveClass("pointer-events-none", "absolute", "right-[12px]", "w-[11px]");
    expect(trackEl().style.top).toBe("505px");
    expect(trackEl().style.height).toBe("790px");
    expect(thumbEl().className).not.toMatch(/translate/);
  });

  it.each([
    [790, 790],
    [791, 790],
    [792, 790],
  ])("stays invisible when the overflow is ≤ 2 px (scrollHeight %i, clientHeight %i)", (scrollHeight, clientHeight) => {
    render(<Harness init={{ scrollHeight, clientHeight, scrollTop: 0 }} />);

    expect(trackEl()).toHaveClass("invisible");
    expect(trackEl().style.visibility).toBe("");
  });

  it("shows once the overflow passes 2 px", () => {
    render(<Harness init={{ scrollHeight: 793, clientHeight: 790, scrollTop: 0 }} />);

    expect(trackEl().style.visibility).toBe("visible");
  });

  it.each([
    [1580, 790, 395], // round(790 × 790/1580)
    [3160, 790, 198], // round(197.5)
    [2370, 790, 263], // round(263.33)
    [100_000, 790, 40], // floor of 40 px
  ])("thumb height = max(40, round(790 × client/scroll)): %i / %i → %i px", (scrollHeight, clientHeight, expected) => {
    render(<Harness init={{ scrollHeight, clientHeight, scrollTop: 0 }} />);

    expect(thumbEl().style.height).toBe(`${expected}px`);
  });

  it("the thumb is never taller than its track", () => {
    render(<Harness height={30} init={{ scrollHeight: 1000, clientHeight: 900, scrollTop: 0 }} />);

    expect(thumbEl().style.height).toBe("30px");
  });

  it("translateY is 0 at the top and height − thumb at the end (proportional between)", () => {
    render(<Harness init={{ scrollHeight: 1580, clientHeight: 790, scrollTop: 0 }} />);
    expect(thumbEl().style.transform).toBe("translateY(0px)");

    scrollTo(790); // the end: overflow = 790
    expect(thumbEl().style.transform).toBe(`translateY(${790 - 395}px)`);

    scrollTo(395);
    expect(thumbEl().style.transform).toBe("translateY(198px)"); // round(0.5 × 395)
  });

  it("observes the pane and each direct child", () => {
    render(<Harness init={{ scrollHeight: 1580, clientHeight: 790, scrollTop: 0 }} />);

    expect(observers).toHaveLength(1);
    expect([...observers[0].observed]).toEqual([pane(), ...Array.from(pane().children)]);
  });

  it("the RO callback repaints when content grows after mount", () => {
    render(<Harness init={{ scrollHeight: 790, clientHeight: 790, scrollTop: 0 }} />);
    expect(trackEl().style.visibility).toBe("");

    metrics.scrollHeight = 1580;
    act(() => observers[0].callback());

    expect(trackEl().style.visibility).toBe("visible");
    expect(thumbEl().style.height).toBe("395px");
  });

  it("a height prop change (the ADA flip) repaints on the same track node", () => {
    const { rerender } = render(<Harness init={{ scrollHeight: 1580, clientHeight: 790, scrollTop: 0 }} />);
    const track = trackEl();

    rerender(<Harness height={578} top={170} init={{ scrollHeight: 1580, clientHeight: 790, scrollTop: 0 }} />);

    expect(trackEl()).toBe(track);
    expect(track.style.top).toBe("170px");
    expect(track.style.height).toBe("578px");
    expect(track.style.visibility).toBe("visible");
    expect(thumbEl().style.height).toBe("289px"); // round(578 × 790/1580)
    expect(observers[0].disconnected).toBe(true); // the old effect cleaned up
    expect(observers).toHaveLength(2);
  });

  it("a new direct child is observed and repaints; a removed one is unobserved; deeper changes are ignored", async () => {
    render(<Harness init={{ scrollHeight: 790, clientHeight: 790, scrollTop: 0 }} />);
    const added = document.createElement("section");

    metrics.scrollHeight = 1580;
    await act(async () => {
      pane().appendChild(added);
      await Promise.resolve(); // MutationObserver records are delivered as a microtask
    });
    expect(observers[0].observed.has(added)).toBe(true);
    expect(trackEl().style.visibility).toBe("visible");
    expect(thumbEl().style.height).toBe("395px");

    await act(async () => {
      pane().removeChild(added);
      await Promise.resolve();
    });
    expect(observers[0].observed.has(added)).toBe(false);

    const deep = document.createElement("i");
    await act(async () => {
      pane().firstElementChild?.appendChild(deep);
      await Promise.resolve();
    });
    expect(observers[0].observed.has(deep)).toBe(false);
  });

  it("unmount removes the scroll listener and disconnects the RO and the MO", () => {
    const addListener = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removeListener = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const moDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const { unmount } = render(<Harness init={{ scrollHeight: 1580, clientHeight: 790, scrollTop: 0 }} />);
    const target = pane();
    const thumb = thumbEl();
    const onScroll = addListener.mock.calls.find(
      ([type], i) => type === "scroll" && addListener.mock.contexts[i] === target
    )?.[1];
    expect(onScroll).toBeTypeOf("function");

    unmount();

    expect(removeListener.mock.calls.some(([type]) => type === "scroll")).toBe(true);
    expect(removeListener.mock.contexts).toContain(target);
    // The SAME function comes off the pane — removing any other one leaks the listener.
    expect(
      removeListener.mock.calls.some(
        ([type, handler], i) => type === "scroll" && handler === onScroll && removeListener.mock.contexts[i] === target
      )
    ).toBe(true);
    expect(observers[0].disconnected).toBe(true);
    expect(moDisconnect).toHaveBeenCalledTimes(1);
    // Nothing paints any more.
    metrics.scrollTop = 790;
    target.dispatchEvent(new Event("scroll"));
    expect(thumb.style.transform).toBe("translateY(0px)");
  });

  it("without ResizeObserver / MutationObserver it still paints and unmounts cleanly", () => {
    globals.ResizeObserver = undefined;
    globals.MutationObserver = undefined;
    const { unmount } = render(<Harness init={{ scrollHeight: 1580, clientHeight: 790, scrollTop: 0 }} />);

    expect(thumbEl().style.height).toBe("395px");
    expect(() => unmount()).not.toThrow();
  });
});

/*
  ── The drag (user request 2026-10-08, reversing D3) ────────────────────────
  jsdom has no layout and no setPointerCapture: layout() mocks the client
  rects the component reads (the track's top/height and the thumb's height,
  as tall as paint() made it, times the stage scale), and capture is stubbed
  per element. jsdom 29 ships PointerEvent, so fireEvent.pointer* carries
  clientY and pointerId.

  Geometry at scale 1, track top 505 / height 790:
    LONG   1580 / 790 → overflow  790, thumb 395, travel 395
    LONGER 3160 / 790 → overflow 2370, thumb 198, travel 592
*/

const LONG = { scrollHeight: 1580, clientHeight: 790, scrollTop: 0 };
const LONGER = { scrollHeight: 3160, clientHeight: 790, scrollTop: 0 };

const stripEl = () => screen.getByTestId("bar-hit");
const press = (clientY: number, pointerId = 1) => fireEvent.pointerDown(stripEl(), { clientY, pointerId });
const moveTo = (clientY: number, pointerId = 1) => fireEvent.pointerMove(stripEl(), { clientY, pointerId });
const release = (clientY: number, pointerId = 1) => fireEvent.pointerUp(stripEl(), { clientY, pointerId });

/** Client-px rects at stage `scale`, the stage `offset` px down the viewport. */
function layout({ top = 505, height = 790, scale = 1, offset = 0 } = {}) {
  const thumb = thumbEl();
  vi.spyOn(trackEl(), "getBoundingClientRect").mockImplementation(
    () => new DOMRect(1057 * scale, offset + top * scale, 11 * scale, height * scale)
  );
  // Only the thumb's height is read; its top follows from scrollTop.
  vi.spyOn(thumb, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(1057 * scale, offset + top * scale, 11 * scale, parseFloat(thumb.style.height) * scale)
  );
}

describe("ScrollIndicator drag strip (user request 2026-10-08, reverses D3)", () => {
  it("is the track's next sibling: aria-hidden, no role or tab stop, absolute right-0 w-[24px] touch-none, at the given top/height", () => {
    render(<Harness init={LONG} />);
    const strip = stripEl();

    expect(trackEl().nextElementSibling).toBe(strip);
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip).not.toHaveAttribute("tabindex");
    expect(strip).not.toHaveAttribute("role");
    expect(strip).toHaveClass("invisible", "absolute", "right-0", "w-[24px]", "touch-none");
    // Not dead CSS: the :active rule makes the strip a Blink tap target, so touch
    // adjustment keeps a finger on the bar instead of the card beside it (header).
    expect(strip).toHaveClass("active:opacity-100");
    expect(strip).not.toHaveClass("pointer-events-none");
    expect(strip).toBeEmptyDOMElement();
    expect(strip.style.top).toBe("505px");
    expect(strip.style.height).toBe("790px");
  });

  it("follows the track's visibility: hidden while the pane fits, shown by RO growth, kept through an ADA flip on the same node, hidden when it fits again", () => {
    const { rerender } = render(<Harness init={{ scrollHeight: 792, clientHeight: 790, scrollTop: 0 }} />);
    const strip = stripEl();
    expect(strip.style.visibility).toBe("");
    expect(trackEl().style.visibility).toBe("");

    metrics.scrollHeight = 1580;
    act(() => observers[0].callback());
    expect(trackEl().style.visibility).toBe("visible");
    expect(strip.style.visibility).toBe("visible");

    rerender(<Harness height={578} top={170} init={LONG} />);
    expect(stripEl()).toBe(strip);
    expect(strip.style.top).toBe("170px");
    expect(strip.style.height).toBe("578px");
    expect(strip.style.visibility).toBe("visible");

    metrics.scrollHeight = 790;
    act(() => observers[1].callback());
    expect(trackEl().style.visibility).toBe("");
    expect(strip.style.visibility).toBe("");
  });

  it("dragging the thumb maps 0 / 50 / 100 % of travel to scrollTop 0 / overflow/2 / overflow, clamped past both ends", () => {
    render(<Harness init={LONG} />);
    layout();

    press(702.5); // the thumb's centre (505 + 395/2): grabbed there
    expect(metrics.scrollTop).toBe(0);
    moveTo(702.5);
    expect(metrics.scrollTop).toBe(0);
    moveTo(702.5 + 197.5);
    expect(metrics.scrollTop).toBe(395);
    moveTo(702.5 + 395);
    expect(metrics.scrollTop).toBe(790);
    moveTo(5000);
    expect(metrics.scrollTop).toBe(790);
    moveTo(-5000);
    expect(metrics.scrollTop).toBe(0);
  });

  it("a press on the thumb keeps the grab offset: a zero-delta move never jumps, also from a non-zero start", () => {
    render(<Harness init={LONG} />);
    layout();
    scrollTo(300); // thumb top = 505 + 300/790 × 395 = 655

    press(665); // 10 px into the thumb
    expect(metrics.scrollTop).toBe(300);
    moveTo(665);
    expect(metrics.scrollTop).toBeCloseTo(300, 9);
    moveTo(665 + 39.5); // +10 % of travel = +79 px of scroll
    expect(metrics.scrollTop).toBeCloseTo(379, 9);
  });

  it("the same mapping at stage scale 0.5 (client-px rects, the stage letterboxed 100 px down)", () => {
    render(<Harness init={LONG} />);
    layout({ scale: 0.5, offset: 100 }); // track 352.5 / 395, thumb 197.5, travel 197.5

    press(352.5 + 98.75); // the thumb's centre
    moveTo(352.5 + 98.75 + 98.75);
    expect(metrics.scrollTop).toBe(395);
    moveTo(352.5 + 98.75 + 197.5);
    expect(metrics.scrollTop).toBe(790);
    moveTo(352.5 + 98.75);
    expect(metrics.scrollTop).toBe(0);
  });

  it("a press on the track below the thumb centres the thumb on the finger at once (no scrollTo), and the same press drags on", () => {
    render(<Harness init={LONGER} />); // thumb 505–703
    layout();
    const smooth = vi.fn();
    pane().scrollTo = smooth;

    press(900); // (900 − 505 − 99) / 592 = 0.5
    expect(metrics.scrollTop).toBe(1185);
    moveTo(1196); // (1196 − 604) / 592 = 1
    expect(metrics.scrollTop).toBe(2370);
    moveTo(752); // 0.25
    expect(metrics.scrollTop).toBe(592.5);
    expect(smooth).not.toHaveBeenCalled();
  });

  it("a press on the track above the thumb jumps up; jumps clamp at both ends", () => {
    render(<Harness init={{ ...LONGER, scrollTop: 2370 }} />); // thumb 1097–1295
    layout();

    press(752); // (752 − 604) / 592 = 0.25
    expect(metrics.scrollTop).toBe(592.5);
    release(752);

    press(510); // above the thumb (now 653–851), past the top
    expect(metrics.scrollTop).toBe(0);
    release(510);

    press(1290); // below the thumb (505–703), past the end
    expect(metrics.scrollTop).toBe(2370);
  });

  it("captures the pointer on the strip with its pointerId", () => {
    render(<Harness init={LONG} />);
    layout();
    const capture = vi.fn();
    stripEl().setPointerCapture = capture;

    press(702.5, 7);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(7);
    expect(capture.mock.contexts[0]).toBe(stripEl());
  });

  it.each<[string, (() => never) | undefined]>([
    ["missing (jsdom)", undefined],
    [
      "throwing",
      () => {
        throw new DOMException("No active pointer with the given id", "NotFoundError");
      },
    ],
  ])("a %s setPointerCapture never crashes, and the drag still works", (_label, impl) => {
    render(<Harness init={LONG} />);
    layout();
    if (impl) stripEl().setPointerCapture = vi.fn(impl);
    else expect(stripEl().setPointerCapture).toBeUndefined();

    expect(() => press(1000)).not.toThrow(); // off the thumb: the jump runs after the capture
    expect(metrics.scrollTop).toBeCloseTo(595, 9); // (1000 − 702.5) / 395 × 790
    moveTo(1097.5);
    expect(metrics.scrollTop).toBe(790);
  });

  it.each(["pointerUp", "pointerCancel", "lostPointerCapture"] as const)("%s ends the drag and lets the held thumb go", (end) => {
    render(<Harness init={LONG} />);
    layout();
    expect(thumbEl()).not.toHaveAttribute("data-held");
    press(702.5);
    moveTo(900);
    expect(metrics.scrollTop).toBe(395);
    expect(thumbEl()).toHaveAttribute("data-held");

    fireEvent[end](stripEl(), { clientY: 900, pointerId: 1 });
    moveTo(1097.5);

    expect(metrics.scrollTop).toBe(395);
    expect(thumbEl()).not.toHaveAttribute("data-held");
  });

  it("ignores moves without a press, moves from another pointer, and a second press mid-drag", () => {
    render(<Harness init={LONG} />);
    layout();
    const capture = vi.fn();
    stripEl().setPointerCapture = capture;

    moveTo(900);
    expect(metrics.scrollTop).toBe(0);

    press(702.5, 1); // pointer 1 grabs the thumb's centre
    moveTo(900, 2);
    expect(metrics.scrollTop).toBe(0);

    press(1290, 2); // would jump to the end if it were let in
    expect(metrics.scrollTop).toBe(0);
    expect(capture).toHaveBeenCalledTimes(1);
    release(1290, 2); // not the owner: the drag goes on
    expect(thumbEl()).toHaveAttribute("data-held");

    moveTo(900, 1);
    expect(metrics.scrollTop).toBe(395); // pointer 1's grab, not pointer 2's
  });

  it("never cancels or stops the pointerdown (the idle timer needs the compat mouse events)", () => {
    render(<Harness init={LONG} />);
    layout();
    const reached = vi.fn();
    document.addEventListener("pointerdown", reached);
    try {
      expect(press(702.5)).toBe(true); // the thumb: a grab
      release(702.5);
      expect(press(1200)).toBe(true); // the track: a jump
    } finally {
      document.removeEventListener("pointerdown", reached);
    }
    expect(reached).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["the pane fits (overflow 2 px)", 790, { scrollHeight: 792, clientHeight: 790, scrollTop: 0 }],
    ["the thumb fills its track (travel 0)", 30, { scrollHeight: 1000, clientHeight: 900, scrollTop: 0 }],
  ])("captures and scrolls nothing when %s", (_label, height, init) => {
    render(<Harness height={height} init={init} />);
    layout({ height });
    const capture = vi.fn();
    stripEl().setPointerCapture = capture;

    press(505 + height / 2);
    moveTo(505 + height);

    expect(capture).not.toHaveBeenCalled();
    expect(metrics.scrollTop).toBe(0);
    expect(thumbEl()).not.toHaveAttribute("data-held");
  });

  it("content that grows mid-drag: no jump, the drag carries on from where the pane is over the live overflow and thumb", () => {
    render(<Harness init={LONG} />);
    layout();
    press(702.5); // grab 197.5
    moveTo(900);
    expect(metrics.scrollTop).toBe(395);

    metrics.scrollHeight = 3160;
    act(() => observers[0].callback());
    expect(thumbEl().style.height).toBe("198px"); // overflow 2370, travel 592

    moveTo(900); // the absolute map alone would jump to 790.7
    expect(metrics.scrollTop).toBeCloseTo(395, 6);
    moveTo(900 + 59.2); // +10 % of the new travel
    expect(metrics.scrollTop).toBeCloseTo(395 + 237, 6);
  });

  it("re-bases when something else moved the pane (a smooth scroll still running, a fling's last frame): no snap back", () => {
    render(<Harness init={LONG} />);
    layout();
    press(702.5); // on the thumb at scrollTop 0, grab 197.5

    scrollTo(600); // e.g. a rail tap's smooth scroll carries on under the held press
    moveTo(702.5); // the press-time grab alone would snap back to 0
    expect(metrics.scrollTop).toBeCloseTo(600, 6);
    moveTo(702.5 + 39.5); // +10 % of travel = +79
    expect(metrics.scrollTop).toBeCloseTo(679, 6);

    scrollTo(679.5); // ≤ 1 px off (the browser snapping our own write): no re-base
    moveTo(702.5 + 79); // +20 % from the press = 158 past the re-based 600
    expect(metrics.scrollTop).toBeCloseTo(758, 6);
    moveTo(5000);
    expect(metrics.scrollTop).toBe(790); // the clamps still hold
    moveTo(-5000);
    expect(metrics.scrollTop).toBe(0);
  });

  it("content that shrinks to fit mid-drag: no throw, no scroll, and the strip hides", () => {
    render(<Harness init={LONG} />);
    layout();
    press(702.5);
    moveTo(900);

    metrics.scrollHeight = 790;
    act(() => observers[0].callback());

    expect(stripEl().style.visibility).toBe("");
    expect(() => moveTo(1097.5)).not.toThrow();
    expect(metrics.scrollTop).toBe(395);
  });

  it("zero React renders across a press, moves, a release and scroll events", () => {
    const onRender = vi.fn();
    render(
      <Profiler id="bar" onRender={onRender}>
        <Harness init={LONG} />
      </Profiler>
    );
    layout();
    const renders = onRender.mock.calls.length;
    expect(renders).toBeGreaterThan(0);

    press(1000); // a jump
    for (let y = 1000; y <= 1100; y += 10) moveTo(y);
    release(1100);
    expect(metrics.scrollTop).toBe(790); // the moves did scroll
    scrollTo(100);
    scrollTo(200);

    expect(onRender).toHaveBeenCalledTimes(renders);
  });

  it("under StrictMode the drag works and one net scroll listener stays on the pane", () => {
    const add = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const remove = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    render(<Harness init={LONG} />, { reactStrictMode: true });
    const onPane = (spy: { mock: { calls: unknown[][]; contexts: unknown[] } }) =>
      spy.mock.calls.filter((args, i) => args[0] === "scroll" && spy.mock.contexts[i] === pane()).length;

    expect(onPane(add)).toBe(2); // StrictMode really did mount, clean up and remount
    expect(onPane(add) - onPane(remove)).toBe(1);

    layout();
    press(702.5);
    moveTo(900);
    expect(metrics.scrollTop).toBe(395);
  });

  it("unmount mid-drag: no throw, and later events do nothing", () => {
    const { unmount } = render(<Harness init={LONG} />);
    layout();
    const strip = stripEl();
    const target = pane();
    press(702.5);
    moveTo(900);

    expect(() => unmount()).not.toThrow();
    fireEvent.pointerMove(strip, { clientY: 1097.5, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientY: 1097.5, pointerId: 1 });
    target.dispatchEvent(new Event("scroll"));

    expect(metrics.scrollTop).toBe(395);
  });

  it("a whole drag adds no document or window listeners", () => {
    render(<Harness init={LONG} />);
    layout();
    const onDocument = vi.spyOn(document, "addEventListener");
    const onWindow = vi.spyOn(window, "addEventListener");

    press(702.5);
    moveTo(900);
    release(900);
    press(1200);
    fireEvent.pointerCancel(stripEl(), { clientY: 1200, pointerId: 1 });

    expect(metrics.scrollTop).toBe(790);
    expect(onDocument).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
  });
});

/*
  ── Boundaries ──────────────────────────────────────────────────────────────
  React 19 never rethrows from an event handler: it reports to window "error"
  (vitest then flags the RUN, not a test), so `expect(() => fireEvent…)
  .not.toThrow()` cannot see a crash inside one. Every test below fails on
  any error a handler reports.
*/

/** Fires the scroll event the browser sends after a write; the repainted thumb's top (design px, track top 505). */
const repaintedThumbTop = () => {
  scrollTo(metrics.scrollTop);
  return 505 + Number(/translateY\((-?[\d.]+)px\)/.exec(thumbEl().style.transform)?.[1]);
};
const repaintedThumbCentre = () => repaintedThumbTop() + parseFloat(thumbEl().style.height) / 2;

describe("ScrollIndicator drag strip — boundaries", () => {
  let reported: unknown[] = [];
  const onError = (e: ErrorEvent) => {
    reported.push(e.error);
    e.preventDefault();
  };
  beforeEach(() => {
    reported = [];
    window.addEventListener("error", onError);
  });
  afterEach(() => {
    window.removeEventListener("error", onError);
    expect(reported).toEqual([]);
  });

  it.each([
    [792, ""],
    [793, "visible"],
  ])("on the initial paint the strip shows exactly when the track does (scrollHeight %i over 790 → %j)", (scrollHeight, expected) => {
    render(<Harness init={{ scrollHeight, clientHeight: 790, scrollTop: 0 }} />);

    expect(stripEl().style.visibility).toBe(expected);
    expect(trackEl().style.visibility).toBe(expected);
    expect(stripEl()).toHaveClass("invisible"); // "" leaves the class hiding it; "visible" overrides it
  });

  it("an ADA flip that makes a fitting pane overflow shows the strip with the track on the same nodes; flipping back hides both", () => {
    const fits = { scrollHeight: 790, clientHeight: 790, scrollTop: 0 };
    const { rerender } = render(<Harness init={fits} />);
    const track = trackEl();
    const strip = stripEl();
    expect(strip.style.visibility).toBe("");

    metrics.clientHeight = 578; // the ADA pane is shorter; its content is not
    rerender(<Harness height={578} top={170} init={fits} />);
    expect(trackEl()).toBe(track);
    expect(stripEl()).toBe(strip);
    expect(track.style.visibility).toBe("visible");
    expect(strip.style.visibility).toBe("visible");
    expect([strip.style.top, strip.style.height]).toEqual(["170px", "578px"]);

    metrics.clientHeight = 790;
    rerender(<Harness init={fits} />);
    expect(stripEl()).toBe(strip);
    expect(track.style.visibility).toBe("");
    expect(strip.style.visibility).toBe("");
    expect([strip.style.top, strip.style.height]).toEqual(["505px", "790px"]);
  });

  it("overshooting an end and coming back resumes at the grab point: the drag's own clamped write never re-bases it", () => {
    render(<Harness init={LONG} />);
    layout();
    press(702.5); // the thumb's centre: grab 197.5

    moveTo(5000);
    expect(metrics.scrollTop).toBe(790);
    moveTo(1097.5); // back at the 100 % point: the thumb waited at the end
    expect(metrics.scrollTop).toBe(790);
    moveTo(900);
    expect(metrics.scrollTop).toBe(395);
    moveTo(-5000);
    expect(metrics.scrollTop).toBe(0);
    moveTo(702.5);
    expect(metrics.scrollTop).toBe(0);
    moveTo(702.5 + 39.5);
    expect(metrics.scrollTop).toBeCloseTo(79, 9);
  });

  it.each([
    ["below", 0, 900, 1185], // thumb 505–703
    ["above", 2370, 752, 592.5], // thumb 1097–1295
  ])(
    "a press %s the thumb captures, puts the thumb's centre under the finger at once (no scrollTo / scrollBy), and the same press drags it on",
    (_side, scrollTop, y, expected) => {
      render(<Harness init={{ ...LONGER, scrollTop }} />);
      layout();
      const smooth = vi.fn();
      Object.assign(pane(), { scrollTo: smooth, scrollBy: smooth });
      const capture = vi.fn();
      stripEl().setPointerCapture = capture;

      press(y, 9);
      expect(capture).toHaveBeenCalledWith(9);
      expect(metrics.scrollTop).toBe(expected);
      expect(repaintedThumbCentre()).toBe(y);

      moveTo(y + 37, 9); // 37 / 592 of travel = 148.125 px of scroll
      expect(metrics.scrollTop).toBe(expected + 148.125);
      expect(repaintedThumbCentre()).toBe(y + 37);
      expect(smooth).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["its top edge", 801, 1185],
    ["its bottom edge", 999, 1185],
    ["1 px above it", 800, (196 / 592) * 2370],
    ["1 px below it", 1000, (396 / 592) * 2370],
  ])("a press on %s: both thumb edges grab without moving the pane, just outside jumps", (_where, y, expected) => {
    render(<Harness init={{ ...LONGER, scrollTop: 1185 }} />); // thumb 801–999
    layout();

    press(y);

    expect(metrics.scrollTop).toBeCloseTo(expected, 9);
  });

  it("at stage scale 0.5 a track press centres the thumb in client px, then drags and clamps the same", () => {
    render(<Harness init={LONGER} />);
    layout({ scale: 0.5, offset: 100 }); // track 352.5 / 395, thumb 99, travel 296

    press(550); // below the thumb (352.5–451.5): (550 − 352.5 − 49.5) / 296 = 0.5
    expect(metrics.scrollTop).toBe(1185);
    moveTo(550 + 74); // +25 % of travel
    expect(metrics.scrollTop).toBe(1777.5);
    moveTo(1920);
    expect(metrics.scrollTop).toBe(2370);
    moveTo(0);
    expect(metrics.scrollTop).toBe(0);
  });

  it.each(["pointerUp", "pointerCancel", "lostPointerCapture"] as const)(
    "after %s a new pointer's press starts a fresh drag (touch ids never repeat); the old pointer stays ignored",
    (end) => {
      render(<Harness init={LONG} />);
      layout();
      const capture = vi.fn();
      stripEl().setPointerCapture = capture;
      press(702.5, 1);
      moveTo(900, 1); // 395: the thumb is now 702.5–1097.5
      fireEvent[end](stripEl(), { clientY: 900, pointerId: 1 });

      press(505, 2); // above the thumb: a jump, clamped at the top
      expect(metrics.scrollTop).toBe(0);
      expect(capture).toHaveBeenLastCalledWith(2);
      moveTo(900, 2);
      expect(metrics.scrollTop).toBe(395);
      moveTo(1097.5, 1);
      expect(metrics.scrollTop).toBe(395);
    }
  );

  it("content that grows under a held thumb: the first move maps the finger's delta over the live overflow, and the same point of the thumb stays under the finger", () => {
    render(<Harness init={LONG} />);
    layout();
    press(515); // 10 px into the thumb (505–900)

    metrics.scrollHeight = 3160; // e.g. the late menu load: overflow 790 → 2370
    act(() => observers[0].callback());
    expect(thumbEl().style.height).toBe("198px"); // travel 592, still at the top

    moveTo(515 + 59.2); // +10 % of the live travel
    expect(metrics.scrollTop).toBeCloseTo(237, 9); // 10 % of 2370, not of the old 790
    expect(515 + 59.2 - repaintedThumbTop()).toBeCloseTo(10, 0);
  });

  it("a held drag survives the pane fitting for a while: no error and no write while it fits, then it drags on 1:1", () => {
    render(<Harness init={LONG} />);
    layout();
    press(702.5);
    moveTo(900);
    expect(metrics.scrollTop).toBe(395);

    metrics.scrollHeight = 790; // e.g. a size pick collapses the groups…
    metrics.scrollTop = 0; // …and the browser clamps the scroll position
    act(() => observers[0].callback());
    moveTo(1000);
    expect(metrics.scrollTop).toBe(0);

    metrics.scrollHeight = 1580;
    act(() => observers[0].callback());
    moveTo(1000);
    const resumed = metrics.scrollTop;
    moveTo(1000 + 39.5); // +10 % of travel
    expect(metrics.scrollTop).toBeCloseTo(resumed + 79, 9);
  });

  it("the finger's moves while the pane fits are not replayed when it regrows: the first move after the regrow, at the same y, does not jump", () => {
    render(<Harness init={LONG} />);
    layout();
    press(702.5); // the thumb's centre: grab 197.5
    moveTo(900);
    expect(metrics.scrollTop).toBe(395);

    metrics.scrollHeight = 790; // the pane fits…
    metrics.scrollTop = 0; // …and the browser clamps the scroll position
    act(() => observers[0].callback());
    moveTo(1000); // the finger travels 100 px while there is nothing to scroll

    metrics.scrollHeight = 1580; // the content grows back
    act(() => observers[0].callback());
    moveTo(1000); // the finger has not moved since: no write may move the pane
    expect(metrics.scrollTop).toBeCloseTo(0, 9); // the stale-y re-base jumped to 200 here
    moveTo(1000 + 39.5); // then 1:1: +10 % of travel
    expect(metrics.scrollTop).toBeCloseTo(79, 9);
  });

  // Mutation-verifier additions: each pins a behaviour a surviving scratch mutant broke.

  it.each([
    ["3 px down (a fling's last frame)", 398],
    ["3 px up", 392],
    ["back to the top (a smooth scroll up to a group)", 0],
  ])("an external move %s under a held thumb re-bases: no snap back, then 1:1 from there", (_label, external) => {
    render(<Harness init={LONG} />);
    layout();
    press(702.5); // the thumb's centre: grab 197.5
    moveTo(900);
    expect(metrics.scrollTop).toBe(395);

    scrollTo(external);
    moveTo(900); // the finger did not move: the pane stays where it was moved to
    expect(metrics.scrollTop).toBeCloseTo(external, 9);
    moveTo(900 + 39.5); // +10 % of travel
    expect(metrics.scrollTop).toBeCloseTo(external + 79, 9);
  });

  it("content that grows mid-drag, then an overshoot past the end: the thumb waits at the end until the finger is back at the grab point", () => {
    render(<Harness init={LONG} />);
    layout();
    press(515); // 10 px into the thumb
    metrics.scrollHeight = 3160; // overflow 790 → 2370: thumb 198, travel 592
    act(() => observers[0].callback());
    moveTo(515 + 59.2); // +10 % of the live travel
    expect(metrics.scrollTop).toBeCloseTo(237, 9);

    moveTo(5000);
    expect(metrics.scrollTop).toBe(2370);
    moveTo(505 + 10 + 592); // back at the 100 % point: still the end
    expect(metrics.scrollTop).toBeCloseTo(2370, 9);
    moveTo(505 + 10 + 592 - 59.2); // −10 % of travel
    expect(metrics.scrollTop).toBeCloseTo(2133, 9);
  });

  it("content that shrinks mid-drag but still overflows (a size pick collapses a group): no jump, the drag carries on over the live overflow", () => {
    render(<Harness init={LONGER} />); // thumb 505–703
    layout();
    press(604); // the thumb's centre: grab 99
    moveTo(604 + 59.2); // +10 % of travel
    expect(metrics.scrollTop).toBeCloseTo(237, 9);

    metrics.scrollHeight = 1580; // overflow 2370 → 790: thumb 395, travel 395
    act(() => observers[0].callback());
    moveTo(604 + 59.2); // the press-time grab alone would jump to 118.4
    expect(metrics.scrollTop).toBeCloseTo(237, 9);
    moveTo(604 + 59.2 + 39.5); // +10 % of the live travel
    expect(metrics.scrollTop).toBeCloseTo(316, 9);
  });

  it("a press on the thumb writes no scrollTop (a running smooth scroll is not cut short); the first move does", () => {
    render(<Harness init={{ ...LONG, scrollTop: 300 }} />); // thumb 655–1050
    layout();
    const writes: number[] = [];
    const m = metrics;
    Object.defineProperty(pane(), "scrollTop", {
      configurable: true,
      get: () => m.scrollTop,
      set: (v: number) => {
        writes.push(v);
        m.scrollTop = v;
      },
    });

    press(665); // 10 px into the thumb
    expect(writes).toEqual([]);
    moveTo(665 + 39.5); // +10 % of travel
    expect(writes).toHaveLength(1);
    expect(metrics.scrollTop).toBeCloseTo(379, 9);
  });

  it("with a working setPointerCapture (the kiosk's Chromium) a whole drag still adds no document or window listeners", () => {
    render(<Harness init={LONG} />);
    layout();
    stripEl().setPointerCapture = vi.fn();
    const onDocument = vi.spyOn(document, "addEventListener");
    const onWindow = vi.spyOn(window, "addEventListener");

    press(702.5);
    moveTo(900);
    release(900);
    press(1200);
    fireEvent.pointerCancel(stripEl(), { clientY: 1200, pointerId: 1 });

    expect(metrics.scrollTop).toBe(790);
    expect(onDocument).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
  });
});
