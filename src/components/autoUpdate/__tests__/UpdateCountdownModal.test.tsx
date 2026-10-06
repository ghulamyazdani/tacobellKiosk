import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import UpdateCountdownModal from "../UpdateCountdownModal";
import i18n from "../../../i18n";

/*
  P9e — the splash update dwell. Mounted only while an update is armed:
  invisible for the first 10 s, then a NON-dismissable 5 → 1 countdown, then
  onElapsed exactly once and "Updating…" until the page leaves. Every disarm
  is an unmount, which must take the 1 Hz interval with it (Rule 5).
*/

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const dialog = () => screen.queryByTestId("update-countdown");
const status = () => screen.queryByTestId("update-countdown-status")?.textContent ?? null;

describe("UpdateCountdownModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("renders NOTHING for the first 10 s — the splash under it stays fully usable", () => {
    const onElapsed = vi.fn();
    const { container } = render(<UpdateCountdownModal onElapsed={onElapsed} />);

    expect(container).toBeEmptyDOMElement();
    tick(9_999);
    expect(container).toBeEmptyDOMElement();
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("10–15 s: a modal alertdialog counting 5 → 1, with no buttons", () => {
    render(<UpdateCountdownModal onElapsed={() => {}} />);
    tick(10_000);

    expect(screen.getByRole("alertdialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Kiosk update");
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      "The kiosk will be ready again in a moment."
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(status()).toBe("Starting in 5s");
    for (const seconds of [4, 3, 2, 1]) {
      tick(1_000);
      expect(status()).toBe(`Starting in ${seconds}s`);
    }
  });

  it("at 15 s: onElapsed exactly ONCE, 'Updating…' stays up, and the interval is gone", () => {
    const onElapsed = vi.fn();
    render(<UpdateCountdownModal onElapsed={onElapsed} />);
    tick(14_999);
    expect(onElapsed).not.toHaveBeenCalled();

    tick(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(status()).toBe("Updating…");
    expect(vi.getTimerCount()).toBe(0);

    tick(60_000);
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(status()).toBe("Updating…");
  });

  it("one jump over the whole dwell still fires once (one interval owns the count — no per-tick re-arm)", () => {
    const onElapsed = vi.fn();
    render(<UpdateCountdownModal onElapsed={onElapsed} />);

    tick(120_000);

    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(status()).toBe("Updating…");
  });

  it("non-dismissable: a tap on the backdrop or the card changes nothing", () => {
    const onElapsed = vi.fn();
    render(<UpdateCountdownModal onElapsed={onElapsed} />);
    tick(11_000);
    const shown = dialog();
    if (!shown) throw new Error("the countdown is not showing");

    fireEvent.click(shown.firstElementChild as Element); // the backdrop
    fireEvent.click(screen.getByRole("heading"));
    fireEvent.click(shown);

    expect(dialog()).toBe(shown);
    expect(status()).toBe("Starting in 4s");
    expect(onElapsed).not.toHaveBeenCalled();
    tick(4_000);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("unmount mid-dwell clears the interval — onElapsed never fires", () => {
    const onElapsed = vi.fn();
    const view = render(<UpdateCountdownModal onElapsed={onElapsed} />);
    tick(12_000);
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
    tick(60_000);
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("a remount (re-arm) starts a FULL 15 s again", () => {
    const onElapsed = vi.fn();
    const view = render(<UpdateCountdownModal onElapsed={onElapsed} />);
    tick(14_000);
    view.unmount();

    render(<UpdateCountdownModal onElapsed={onElapsed} />);
    tick(9_999);
    expect(dialog()).toBeNull();
    tick(5_000);
    expect(onElapsed).not.toHaveBeenCalled();
    tick(1);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("StrictMode: one live interval, one decrement per second, onElapsed once", () => {
    const onElapsed = vi.fn();
    render(<UpdateCountdownModal onElapsed={onElapsed} />, { reactStrictMode: true });
    expect(vi.getTimerCount()).toBe(1);

    tick(10_000);
    expect(status()).toBe("Starting in 5s");
    tick(1_000);
    expect(status()).toBe("Starting in 4s");
    tick(4_000);
    expect(onElapsed).toHaveBeenCalledTimes(1);
    tick(60_000);
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("calls the LATEST onElapsed (the parent re-renders while it counts)", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(<UpdateCountdownModal onElapsed={first} />);
    tick(5_000);

    view.rerender(<UpdateCountdownModal onElapsed={latest} />);
    tick(10_000);

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("Arabic copy", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(<UpdateCountdownModal onElapsed={() => {}} />);
    tick(10_000);

    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(i18n.t("update.title"));
    expect(status()).toBe(i18n.t("update.countdown", { seconds: 5 }));
    tick(5_000);
    expect(status()).toBe(i18n.t("update.inProgress"));
  });
});
