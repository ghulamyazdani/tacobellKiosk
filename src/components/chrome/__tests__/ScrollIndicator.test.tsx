import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import ScrollIndicator from "../ScrollIndicator";

/*
  Post-P9 26 — the Figma 1:5263 scroll bar: an INDICATOR only (D3). No React
  state: visibility, size and position are DOM writes through refs, repainted
  by the pane's scroll event, a ResizeObserver on the pane and each direct
  child, and a childList MutationObserver. jsdom has no layout, so each test
  backs the pane's three scroll metrics itself and captures the RO callback.
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
