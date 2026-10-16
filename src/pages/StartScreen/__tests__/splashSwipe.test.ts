import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FOCUS,
  PITCH,
  SETTLE_MAX_MS,
  SETTLE_MIN_MS,
  SIDE,
  SWIPE_COMMIT,
  SWIPE_FLICK_MIN_PX,
  SWIPE_FLICK_PX_MS,
  SWIPE_SLOP_PX,
  SWIPE_VELOCITY_MS,
  VEIL,
  enterAt,
  focusAt,
  matrixOf,
  settleMs,
  target,
  velocity,
} from "../splashSwipe";

/*
  The splash carousel's swipe math (user request 2026-10-16), stage px. The
  knobs are hardware knobs: these pin today's values and the rules around
  them — the slop, the speed window, the commit rule, the settle, the focus.
*/

describe("the hardware knobs", () => {
  it("slop 16 px (≥ Chromium's 15 DIP tap slop) · commit 30 % · flick 0.30 px/ms after 32 px · speed over 100 ms · settle 250–500 ms", () => {
    expect([SWIPE_SLOP_PX, SWIPE_COMMIT, SWIPE_FLICK_PX_MS, SWIPE_FLICK_MIN_PX, SWIPE_VELOCITY_MS]).toEqual([16, 0.3, 0.3, 32, 100]);
    expect([SETTLE_MIN_MS, SETTLE_MAX_MS]).toEqual([250, 500]);
  });

  it("the focus constants are index.css's tokens (one design, two readers)", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "..", "..", "index.css"), "utf8");
    const token = (name: string) => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
    expect(token("--tb-splash-pitch")).toBe(`${PITCH}px`);
    expect(token("--tb-splash-focus")).toBe(String(FOCUS));
    expect(token("--tb-splash-side")).toBe(String(SIDE));
    expect(token("--tb-splash-veil")).toBe(String(VEIL));
  });

  it("the peek stays Figma's 88 px: 540 + pitch − 340 × side = 992 (to the half pixel)", () => {
    expect(540 + PITCH - 340 * SIDE).toBeCloseTo(992, 0);
  });
});

describe("velocity: over the last 100 ms of the drag", () => {
  it("px/ms from the oldest sample inside the window to the release", () => {
    const samples = [[0, 0], [40, -100], [80, -200], [120, -300]] as const;
    // At 130 the window starts at 30: the oldest inside it is t 40 (x −100).
    expect(velocity(samples, [130, -320])).toBeCloseTo(-220 / 90, 6);
  });

  it("a sample exactly 100 ms old still counts; 101 ms old does not", () => {
    expect(velocity([[0, 0], [50, 50]], [100, 100])).toBe(1);
    expect(velocity([[0, 0]], [101, 100])).toBe(0);
  });

  it("a finger that stopped before lifting reads 0 (no sample in the window)", () => {
    expect(velocity([[0, 0], [100, -400]], [250, -400])).toBe(0);
  });

  it("no time between the sample and the release reads 0, never Infinity", () => {
    expect(velocity([[50, -100]], [50, -100])).toBe(0);
    expect(velocity([], [50, -100])).toBe(0);
  });
});

describe("target: where a release lands (+1 next, −1 prev, 0 back)", () => {
  it("a press that never crossed the slop sideways stays, whatever its numbers", () => {
    expect(target(0.9, -5, 600, false)).toBe(0);
  });

  it("a slow release steps at 30 % of a card, both ways (225 px)", () => {
    expect(target(0.3, 0, 241, true)).toBe(1);
    expect(target(0.299, 0, 240, true)).toBe(0);
    expect(target(-0.3, 0, 241, true)).toBe(-1);
    expect(target(-0.299, 0, 240, true)).toBe(0);
  });

  it("a flick (≥ 0.30 px/ms after ≥ 32 px of raw travel) steps in its own direction from anywhere", () => {
    expect(target(0.05, -0.3, 32, true)).toBe(1);
    expect(target(-0.05, 0.3, 32, true)).toBe(-1);
  });

  it("…but not too slow (0.29 px/ms) or too short (31 px): then the 30 % rule decides", () => {
    expect(target(0.05, -0.29, 200, true)).toBe(0);
    expect(target(0.05, -2, 31, true)).toBe(0);
    expect(target(0.5, -0.29, 400, true)).toBe(1);
  });

  it("a fling back cancels: out past 30 % to the left, flung right, back to the slots", () => {
    expect(target(0.6, 1.2, 451, true)).toBe(0);
    expect(target(-0.6, -1.2, 451, true)).toBe(0);
  });

  it("after a catch a flick lands on the nearest card in its own direction (ceil leftward, floor rightward)", () => {
    // Caught on the way to the next (its centre still 300 px right: p −0.4): a left flick
    // completes that step (0), a right flick goes back past it (−1).
    expect(target(-0.4, -1, 60, true)).toBe(0);
    expect(target(-0.4, 1, 60, true)).toBe(-1);
    expect(Object.is(target(-0.4, -1, 60, true), 0)).toBe(true); // never −0
  });

  it("after a catch a slow release never steps against the drag: caught 0.73 of a card off its slot (o +549), a 50 px LEFT drag lifted still stays (never prev); a RIGHT one goes back", () => {
    expect(target(-0.69, 0, 50, true, 0.05)).toBe(0);
    expect(target(-0.75, 0, 50, true, -0.02)).toBe(-1);
    expect(target(0.69, 0, 50, true, -0.05)).toBe(0);
  });

  it("one card per gesture at most", () => {
    expect(target(1, -9, 900, true)).toBe(1);
    expect(target(-1, 9, 900, true)).toBe(-1);
  });
});

describe("settleMs: ViewPager's 4·d/v, clamped", () => {
  it("is 4·d/v in between", () => {
    expect(settleMs(300, 4)).toBe(300);
    expect(settleMs(367, -4)).toBe(367);
  });

  it("clamps at 250 (a fast flick near the card) and 500 (a slow or stopped finger)", () => {
    expect(settleMs(100, 10)).toBe(250);
    expect(settleMs(450, 1)).toBe(500);
    expect(settleMs(450, 0)).toBe(500);
  });
});

describe("focusAt: the focus follows position", () => {
  it("1.10 / veil 0 centred, 0.88 / 0.45 a card away or more, linear in between", () => {
    expect(focusAt(0, 0)).toEqual({ scale: 1.1, veil: 0 });
    // The next card 40 % of the way in (300.4 px): u 0.6.
    expect(focusAt(1, -0.4 * PITCH).scale).toBeCloseTo(0.968, 6);
    expect(focusAt(1, -0.4 * PITCH).veil).toBeCloseTo(0.27, 6);
    expect(focusAt(-1, 0)).toEqual({ scale: 0.88, veil: 0.45 });
    expect(focusAt(-1, -300)).toEqual({ scale: 0.88, veil: 0.45 }); // further out: capped
  });

  it("the centre dragged a whole card is a peek; a peek dragged home is the centre", () => {
    expect(focusAt(0, -PITCH).scale).toBeCloseTo(0.88, 6);
    expect(focusAt(1, -PITCH).scale).toBeCloseTo(1.1, 6);
  });

  it("still (reduced motion): the slot's own focus wherever the card is dragged", () => {
    expect(focusAt(0, -300, true)).toEqual({ scale: 1.1, veil: 0 });
    expect(focusAt(1, -300, true)).toEqual({ scale: 0.88, veil: 0.45 });
  });
});

describe("enterAt: a release's entrant comes in in formation, never on stage", () => {
  it("one pitch beyond the new peek, where the finger left the row: 2 × 751 + o (mirrored for prev)", () => {
    expect(enterAt(1, -434)).toBe(1068);
    expect(enterAt(-1, 434)).toBe(-1068);
    expect(enterAt(1, 0)).toBe(2 * PITCH); // a tap's pending video end: the auto-advance's two pitches
  });

  it("a long drag's stays off stage: a 0.88 card from ≈ 839 px out has its left edge at 1080", () => {
    expect(enterAt(1, -700)).toBeCloseTo(540 + 340 * SIDE, 6);
    expect(enterAt(-1, 751)).toBeCloseTo(-(540 + 340 * SIDE), 6);
    expect(540 + enterAt(1, -751) - 340 * SIDE).toBeCloseTo(1080, 6);
  });
});

describe("matrixOf: a computed transform's x and scale", () => {
  it("reads e and a of matrix(a, b, c, d, e, f)", () => {
    expect(matrixOf("matrix(0.968, 0, 0, 0.968, 451.25, 0)")).toEqual([451.25, 0.968]);
    expect(matrixOf("matrix(1.1, 0, 0, 1.1, -226.8, 0)")).toEqual([-226.8, 1.1]);
  });

  it("anything else (none; jsdom's empty value; garbage) is x 0, scale 1", () => {
    for (const value of ["none", "", "matrix(1, 0)", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)", "matrix(a, b, c, d, e, f)"]) {
      expect(matrixOf(value), value).toEqual([0, 1]);
    }
  });
});
