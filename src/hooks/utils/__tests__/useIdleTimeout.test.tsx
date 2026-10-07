import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  IDLE_HOLD_MAX_MS,
  IDLE_MAX_SECONDS,
  IDLE_PROMPT_SECONDS,
  IdleHoldContext,
  PAYMENT_IDLE_HOLD_MAX_MS,
  resolveIdleSeconds,
  useIdleHold,
} from "../useIdleTimeout";

/*
  The two halves of the P9a policy module, tested without the guard:
  - resolveIdleSeconds — the D1 table (Rule 1's 120 s is a CEILING);
  - useIdleHold — the +1/-1 hold primitive, against a spy standing in for
    IdleGuard's counter. The guard's reaction to holds is IdleGuard.test.
*/

describe("resolveIdleSeconds — ideal_time may shorten the 120 s timeout, never lengthen it", () => {
  it.each([
    [120, 120],
    ["120", 120],
    // The e2e fixtures send "180": capped, not honoured (Rule 1).
    ["180", 120],
    [9999, 120],
    ["90", 90],
    [60, 60],
    // Below the 60 s floor: clamped up, so a customer is not cut off mid-read.
    ["45", 60],
    [21, 60],
    // parseInt base 10 — decimals truncate, they do not round.
    ["100.7", 100],
    // Unparseable / missing / not longer than the prompt -> Rule 1's 120 s.
    ["abc", 120],
    [undefined, 120],
    [null, 120],
    ["", 120],
    [0, 120],
    [20, 120],
    [-30, 120],
  ])("%j -> %i s", (raw, expected) => {
    expect(resolveIdleSeconds(raw)).toBe(expected);
  });

  it("always leaves room for the whole prompt, so react-idle-timer never throws", () => {
    // The library throws (inside an effect = a render crash) when
    // promptBeforeIdle >= timeout. Sweep well past both clamps.
    for (let raw = -50; raw <= 400; raw += 1) {
      const total = resolveIdleSeconds(raw);
      expect(total).toBeGreaterThan(IDLE_PROMPT_SECONDS);
      expect(total).toBeLessThanOrEqual(IDLE_MAX_SECONDS);
    }
  });
});

describe("useIdleHold — the +1/-1 hold IdleGuard counts", () => {
  /** The guard's adjustHold, as a spy. */
  const adjust = vi.fn<(delta: 1 | -1) => void>();

  const provider = ({ children }: { children: ReactNode }) => (
    <IdleHoldContext.Provider value={adjust}>{children}</IdleHoldContext.Provider>
  );

  /** What the guard's counter would read now. */
  const net = () => adjust.mock.calls.reduce((sum, [delta]) => sum + delta, 0);

  // reactStrictMode wraps at the ROOT, like main.tsx. (React 19 only
  // double-invokes mount effects when StrictMode sits at or above the newly
  // placed subtree — a StrictMode inside the wrapper would test nothing.)
  const hold = (active: boolean, reactStrictMode = false) =>
    renderHook(({ on }: { on: boolean }) => useIdleHold(on), {
      initialProps: { on: active },
      wrapper: provider,
      reactStrictMode,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    adjust.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a no-op outside the idle subtree (/start, boot): no hold, no cap timer", () => {
    const { unmount } = renderHook(() => useIdleHold(true));

    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("takes nothing while inactive", () => {
    hold(false);

    expect(adjust).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes one hold while active and gives it back when work ends", () => {
    const { rerender } = hold(false);

    rerender({ on: true });
    expect(adjust.mock.calls).toEqual([[1]]);

    rerender({ on: false });
    expect(adjust.mock.calls).toEqual([[1], [-1]]);
    // The cap went with it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives the hold back when the holder unmounts mid-work", () => {
    const { unmount } = hold(true);
    expect(net()).toBe(1);

    unmount();

    expect(adjust.mock.calls).toEqual([[1], [-1]]);
  });

  it("caps a hung hold at IDLE_HOLD_MAX_MS and releases it exactly once", () => {
    const { rerender, unmount } = hold(true);

    act(() => {
      vi.advanceTimersByTime(IDLE_HOLD_MAX_MS - 1);
    });
    expect(net()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(adjust.mock.calls).toEqual([[1], [-1]]);

    // The work finally ending — or the screen leaving — must not release a
    // second time and drive the guard's counter below the other holders.
    rerender({ on: false });
    unmount();
    expect(adjust.mock.calls).toEqual([[1], [-1]]);
  });

  it("a fresh activation after the cap takes a fresh hold (e.g. a retry)", () => {
    const { rerender } = hold(true);
    act(() => {
      vi.advanceTimersByTime(IDLE_HOLD_MAX_MS);
    });
    rerender({ on: false });
    expect(net()).toBe(0);

    rerender({ on: true });

    expect(net()).toBe(1);
  });

  it("StrictMode's mount -> unmount -> mount nets ONE hold with ONE live cap", () => {
    hold(true, true);

    expect(adjust.mock.calls).toEqual([[1], [-1], [1]]);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(IDLE_HOLD_MAX_MS);
    });

    expect(net()).toBe(0);
    expect(adjust).toHaveBeenCalledTimes(4);
  });

  describe("maxMs — the per-hold cap (P8b D2)", () => {
    const holdFor = (maxMs?: number) =>
      renderHook(({ on, cap }: { on: boolean; cap?: number }) => useIdleHold(on, cap), {
        initialProps: { on: true, cap: maxMs },
        wrapper: provider,
      });
    const after = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });

    it("PAYMENT_IDLE_HOLD_MAX_MS is 240 s — the 180 s EDC window + 30 s settle + one void extension", () => {
      expect(PAYMENT_IDLE_HOLD_MAX_MS).toBe(240_000);
      expect(PAYMENT_IDLE_HOLD_MAX_MS).toBeGreaterThan(IDLE_HOLD_MAX_MS);
    });

    it("omitted, the cap is IDLE_HOLD_MAX_MS (every pre-P8b caller is unchanged)", () => {
      holdFor();
      after(IDLE_HOLD_MAX_MS - 1);
      expect(net()).toBe(1);
      after(1);
      expect(adjust.mock.calls).toEqual([[1], [-1]]);
    });

    it("a custom cap holds past the default and releases exactly at maxMs, once", () => {
      const { rerender, unmount } = holdFor(PAYMENT_IDLE_HOLD_MAX_MS);
      after(IDLE_HOLD_MAX_MS);
      expect(net()).toBe(1);
      after(PAYMENT_IDLE_HOLD_MAX_MS - IDLE_HOLD_MAX_MS - 1);
      expect(net()).toBe(1);
      after(1);
      expect(adjust.mock.calls).toEqual([[1], [-1]]);

      rerender({ on: false, cap: PAYMENT_IDLE_HOLD_MAX_MS });
      unmount();
      expect(adjust.mock.calls).toEqual([[1], [-1]]);
    });

    it("a changed cap re-arms: the old hold is given back, a fresh one runs to the NEW cap", () => {
      const { rerender } = holdFor(IDLE_HOLD_MAX_MS);
      after(100_000);
      rerender({ on: true, cap: PAYMENT_IDLE_HOLD_MAX_MS });
      expect(adjust.mock.calls).toEqual([[1], [-1], [1]]);
      expect(vi.getTimerCount()).toBe(1);

      after(PAYMENT_IDLE_HOLD_MAX_MS - 1);
      expect(net()).toBe(1);
      after(1);
      expect(net()).toBe(0);
    });

    it("an unchanged cap across re-renders keeps the same hold (no re-arm)", () => {
      const { rerender } = holdFor(PAYMENT_IDLE_HOLD_MAX_MS);
      after(200_000);
      rerender({ on: true, cap: PAYMENT_IDLE_HOLD_MAX_MS });
      expect(adjust.mock.calls).toEqual([[1]]);
      after(PAYMENT_IDLE_HOLD_MAX_MS - 200_000);
      expect(net()).toBe(0);
    });
  });
});
