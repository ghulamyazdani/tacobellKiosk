import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { createMocks } from "react-idle-timer";
import { setIdealTimeout } from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../redux/app/store";
import { useIdleHold } from "../../hooks/utils/useIdleTimeout";
import { KioskEventName } from "../../utils/analytics";
import IdleGuard from "../IdleGuard";
import i18n from "../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n, fake
  clock. The guard runs the REAL react-idle-timer, REAL navigation (it must
  actually unmount on /start) and REAL holds; the pages are stubs.

  Mocked, and only these:
  - captureKioskEvent (a no-op unless PostHog is live) — the exit analytics
    are part of the contract;
  - useNavigate, as a PASS-THROUGH spy: navigation still happens, but "tear
    down once" is a call count.

  react-idle-timer binds the timer functions it finds at IMPORT time, i.e.
  the real ones; createMocks() (the library's own test hook) re-reads the
  globals, so it must run after every vi.useFakeTimers().

  With the slice default ideal_time (180) the Rule-1 ceiling applies: one
  idle period is 120 s, the prompt is its last 20 s.
*/

const mockCapture = vi.fn();
const navigateCalls = vi.fn();

vi.mock("../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return (...args: unknown[]) => {
        navigateCalls(...args);
        return (navigate as (...a: unknown[]) => unknown)(...args);
      };
    },
  };
});

/** An in-session screen: two independent holds + an await-then-navigate. */
function Page({ name }: { name: string }) {
  const navigate = useNavigate();
  const [holdA, setHoldA] = useState(false);
  const [holdB, setHoldB] = useState(false);
  useIdleHold(holdA);
  useIdleHold(holdB);
  return (
    <div data-testid={`page-${name}`}>
      <button type="button" data-testid="hold-a" onClick={() => setHoldA((v) => !v)} />
      <button type="button" data-testid="hold-b" onClick={() => setHoldB((v) => !v)} />
      {/* An unguarded continuation landing after the session ended. */}
      <button type="button" data-testid="late-nav" onClick={() => navigate("/menu")} />
    </div>
  );
}

const mount = (path = "/menu") =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/start" element={<div data-testid="splash" />} />
          <Route element={<IdleGuard />}>
            <Route path="/menu" element={<Page key="menu" name="menu" />} />
            <Route path="/cart" element={<Page key="cart" name="cart" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>
  );

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const tap = (testId: string) => {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const prompt = () => screen.queryByTestId("idle-modal");
const splash = () => screen.queryByTestId("splash");
const cartRows = () =>
  (store.getState() as { cart: { cartItems: unknown[] } }).cart.cartItems;
/** The lilac fill behind START AGAIN. */
const fill = () =>
  screen
    .getByTestId("idle-start-again")
    .querySelector<HTMLElement>('[aria-hidden="true"]');

const ROW = {
  id: "crunchwrap",
  itemId: "cw-1",
  name: "Crunchwrap Supreme",
  quantity: 1,
  type: "ITEM",
  total_price: 24.5,
};

describe("IdleGuard — the in-session idle timeout (P9a)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createMocks();
    mockCapture.mockReset();
    navigateCalls.mockReset();
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the clock", () => {
    it("opens the prompt for the LAST 20 s only: nothing at 99.999 s, prompt at 100 s", () => {
      mount();

      advance(99_999);
      expect(prompt()).not.toBeInTheDocument();

      advance(1);
      expect(prompt()).toBeInTheDocument();
      expect(navigateCalls).not.toHaveBeenCalled();
    });

    it("a shorter configured ideal_time shortens it (60 s: prompt at 40 s, reset at 60 s)", () => {
      store.dispatch(setIdealTimeout(60));
      mount();

      advance(39_999);
      expect(prompt()).not.toBeInTheDocument();
      advance(1);
      expect(prompt()).toBeInTheDocument();

      advance(20_000);
      expect(splash()).toBeInTheDocument();
    });

    it("page activity before the prompt restarts the full period", () => {
      mount();
      advance(90_000);

      act(() => {
        fireEvent.mouseDown(document);
      });

      advance(99_999);
      expect(prompt()).not.toBeInTheDocument();
      advance(1);
      expect(prompt()).toBeInTheDocument();
    });

    it("shows the library's clock: the opening seconds announced once, the fill tracking elapsed time", () => {
      mount();
      advance(100_000);
      const countdown = i18n.t("idle.countdownA11y", { seconds: 20 });

      expect(screen.getByText(countdown)).toBeInTheDocument();
      expect(fill()?.style.width).toBe("0%");

      advance(10_000);
      expect(fill()?.style.width).toBe("50%");

      advance(5_000);
      expect(fill()?.style.width).toBe("75%");
      // Announced with the opening value only — never ticked.
      expect(screen.getByText(countdown)).toBeInTheDocument();
    });
  });

  describe("while prompted", () => {
    it("ignores page activity — only CONTINUE extends (react-idle-timer drops events while prompted)", () => {
      mount();
      advance(100_000);

      // Spaced past the library's 200 ms listener throttle, so each one
      // really reaches it.
      for (const touch of [
        () => fireEvent.mouseDown(document),
        () => fireEvent.touchStart(document),
        () => fireEvent.keyDown(document, { key: "1" }),
      ]) {
        advance(1_000);
        act(touch);
      }
      expect(prompt()).toBeInTheDocument();

      advance(17_000);
      expect(splash()).toBeInTheDocument();
    });

    it.each(["idle-continue", "idle-backdrop"])(
      "%s — even in the last second — closes the prompt and restarts a FULL period",
      (testId) => {
        mount();
        advance(119_000);
        expect(prompt()).toBeInTheDocument();

        tap(testId);
        expect(prompt()).not.toBeInTheDocument();

        advance(99_999);
        expect(prompt()).not.toBeInTheDocument();
        expect(splash()).not.toBeInTheDocument();
        advance(1);
        expect(prompt()).toBeInTheDocument();
        expect(mockCapture).not.toHaveBeenCalled();
        expect(navigateCalls).not.toHaveBeenCalled();
      }
    );
  });

  describe("the two exits — navigate only; /start's mount owns the teardown", () => {
    it("the timeout at 120 s: Timeout analytics with the route, ONE navigate to /start, store untouched", () => {
      store.dispatch(setCartItems([{ ...ROW }]));
      mount("/cart");

      advance(119_999);
      expect(screen.getByTestId("page-cart")).toBeInTheDocument();
      expect(navigateCalls).not.toHaveBeenCalled();

      advance(1);

      expect(splash()).toBeInTheDocument();
      expect(mockCapture).toHaveBeenCalledTimes(1);
      expect(mockCapture).toHaveBeenCalledWith(KioskEventName.Timeout, {
        reason: "idle_timeout",
        route_path: "/cart",
      });
      expect(navigateCalls.mock.calls).toEqual([["/start"]]);
      // Hazard H1: resetting here would render the empty store on /cart
      // first and its guards would bounce the kiosk to /menu.
      expect(cartRows()).toHaveLength(1);
    });

    it("START AGAIN: KioskReset analytics with the route, ONE navigate to /start, store untouched", () => {
      store.dispatch(setCartItems([{ ...ROW }]));
      mount("/menu");
      advance(100_000);

      tap("idle-start-again");

      expect(splash()).toBeInTheDocument();
      expect(mockCapture).toHaveBeenCalledTimes(1);
      expect(mockCapture).toHaveBeenCalledWith(KioskEventName.KioskReset, {
        reason: "idle_prompt_start_again",
        route_path: "/menu",
      });
      expect(navigateCalls.mock.calls).toEqual([["/start"]]);
      expect(cartRows()).toHaveLength(1);
    });

    it.each([
      [
        "START AGAIN, then the timeout",
        KioskEventName.KioskReset,
        () => {
          fireEvent.click(screen.getByTestId("idle-start-again"));
          vi.advanceTimersByTime(20_000);
        },
      ],
      [
        "the timeout, then START AGAIN",
        KioskEventName.Timeout,
        () => {
          vi.advanceTimersByTime(20_000);
          fireEvent.click(screen.getByTestId("idle-start-again"));
        },
      ],
    ])("%s in the same tick tear down ONCE", (_order, winner, both) => {
      mount();
      advance(100_000);

      // One act = both land before React commits the navigation, i.e.
      // while the guard is still mounted.
      act(both);

      expect(mockCapture).toHaveBeenCalledTimes(1);
      expect(mockCapture).toHaveBeenCalledWith(
        winner,
        expect.objectContaining({ route_path: "/menu" })
      );
      expect(navigateCalls.mock.calls).toEqual([["/start"]]);
      expect(splash()).toBeInTheDocument();
    });

    it("leaves nothing running on /start (Rule 5): no timers, no further exits", () => {
      mount();
      advance(120_000);
      expect(splash()).toBeInTheDocument();

      // One tick drains jsdom's own 0 ms selectionchange (the focused
      // CONTINUE left the DOM); the idle timer and the 4 Hz prompt tick
      // must already be gone.
      advance(1);
      expect(vi.getTimerCount()).toBe(0);
      act(() => {
        fireEvent.mouseDown(document);
      });
      advance(10 * 60_000);
      expect(mockCapture).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["the timeout", () => vi.advanceTimersByTime(20_000)],
      [
        "START AGAIN",
        () => fireEvent.click(screen.getByTestId("idle-start-again")),
      ],
    ])(
      "self-heals when a late page navigation outruns %s: prompt closed, fresh period, exit live again",
      (_exit, exit) => {
        mount("/cart");
        advance(100_000);

        // Same transition: our navigate("/start") and the page's late
        // navigate("/menu"). The last push wins, so the guard never unmounts.
        act(() => {
          exit();
          fireEvent.click(screen.getByTestId("late-nav"));
        });

        expect(screen.getByTestId("page-menu")).toBeInTheDocument();
        expect(splash()).not.toBeInTheDocument();
        // activate() (not reset()) — onActive takes the prompt down.
        expect(prompt()).not.toBeInTheDocument();

        advance(99_999);
        expect(prompt()).not.toBeInTheDocument();
        advance(1);
        expect(prompt()).toBeInTheDocument();

        // Un-latched: the next timeout really ends the session.
        advance(20_000);
        expect(splash()).toBeInTheDocument();
        expect(mockCapture).toHaveBeenCalledTimes(2);
      }
    );
  });

  describe("holds (in-flight work idle must not cut off)", () => {
    it("suspend the prompt and the timeout — until the 120 s cap gives up on a hung call", () => {
      mount();
      tap("hold-a");

      advance(119_999);
      expect(prompt()).not.toBeInTheDocument();
      expect(screen.getByTestId("page-menu")).toBeInTheDocument();

      // The cap released the hold at 120 s; a fresh period started there.
      advance(1);
      advance(99_999);
      expect(prompt()).not.toBeInTheDocument();
      advance(1);
      expect(prompt()).toBeInTheDocument();

      advance(20_000);
      expect(splash()).toBeInTheDocument();
      expect(mockCapture).toHaveBeenCalledWith(
        KioskEventName.Timeout,
        expect.anything()
      );
    });

    it("releasing the hold starts a fresh FULL period", () => {
      mount();
      advance(90_000);
      tap("hold-a");
      // Past where the prompt AND the reset would have been.
      advance(30_000);
      expect(prompt()).not.toBeInTheDocument();
      expect(splash()).not.toBeInTheDocument();

      tap("hold-a");

      advance(99_999);
      expect(prompt()).not.toBeInTheDocument();
      advance(1);
      expect(prompt()).toBeInTheDocument();
    });

    it("a hold that starts while prompted closes the prompt (it could never resolve)", () => {
      mount();
      advance(100_000);
      expect(prompt()).toBeInTheDocument();

      tap("hold-a");
      expect(prompt()).not.toBeInTheDocument();

      advance(60_000);
      expect(prompt()).not.toBeInTheDocument();
      expect(splash()).not.toBeInTheDocument();

      tap("hold-a");
      advance(99_999);
      expect(prompt()).not.toBeInTheDocument();
      advance(1);
      expect(prompt()).toBeInTheDocument();
    });

    it("count: idle stays suspended until the LAST holder lets go", () => {
      mount();
      tap("hold-a");
      tap("hold-b");
      advance(50_000);
      tap("hold-a");

      advance(60_000);
      expect(prompt()).not.toBeInTheDocument();

      tap("hold-b");
      advance(99_999);
      expect(prompt()).not.toBeInTheDocument();
      advance(1);
      expect(prompt()).toBeInTheDocument();
    });
  });
});
