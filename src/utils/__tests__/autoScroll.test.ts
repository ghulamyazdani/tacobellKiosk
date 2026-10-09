import { afterEach, describe, expect, it, vi } from "vitest";
import AutoScroll, { scrollBehavior } from "../autoScroll";

/*
  Motion §3.9 / D-M4: programmatic scroll is smooth, or an instant jump when
  the OS asks for reduced motion — read on every call (an OS toggle applies
  to the next scroll). setupTests mocks matchMedia to `matches: false`.
*/

const defaultMatchMedia = window.matchMedia;

/** The OS answers `reduce` for the reduced-motion query only. */
const prefersReducedMotion = () => {
  window.matchMedia = (query: string) => ({
    ...defaultMatchMedia(query),
    matches: query === "(prefers-reduced-motion: reduce)",
  });
};

afterEach(() => {
  window.matchMedia = defaultMatchMedia;
});

describe("scrollBehavior", () => {
  it("smooth with the default (no-preference) mock", () => {
    expect(scrollBehavior()).toBe("smooth");
  });

  it("auto (an instant jump) when prefers-reduced-motion: reduce matches — read per call", () => {
    prefersReducedMotion();
    expect(scrollBehavior()).toBe("auto");

    window.matchMedia = defaultMatchMedia;
    expect(scrollBehavior()).toBe("smooth");
  });

  it("smooth, never a crash, where the browser has no matchMedia", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(scrollBehavior()).toBe("smooth");
  });
});

describe("AutoScroll (the PDP auto-advance)", () => {
  it("passes scrollBehavior() to scrollTo", () => {
    const scrollTo = vi.fn();

    AutoScroll({ scrollTo }, 500, 100);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 400, behavior: "smooth" }));

    prefersReducedMotion();
    AutoScroll({ scrollTo }, 500, 100);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 400, behavior: "auto" }));
  });
});
