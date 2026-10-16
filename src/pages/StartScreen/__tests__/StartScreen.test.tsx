import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { CookiesProvider } from "react-cookie";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import { emptyMenuData, setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { setKioskSettings, setMediaData } from "@cx-sdk/catalog/state/appSettings.slice";
import { KioskEventName } from "@cx-sdk/core";
import { store } from "../../../redux/app/store";
import StartScreen from "../index";
import { loadActivityModal } from "../../../components/activity/loadActivityModal";
import "../../../i18n";

/** Flip `crash.media` to make the media layer throw during render. */
const { crash } = vi.hoisted(() => ({ crash: { media: false } }));

const { mockCapture, mockResetSession } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockResetSession: vi.fn(),
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
  resetAnalyticsSession: () => mockResetSession(),
}));

vi.mock("@cx-sdk/catalog/media/splashMedia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cx-sdk/catalog/media/splashMedia")>();
  return {
    ...actual,
    toSplashSlides: (mediaData: unknown) => {
      if (crash.media) throw new Error("splash media render crash");
      return actual.toSplashSlides(mediaData);
    },
  };
});

const renderStart = (options: { reactStrictMode?: boolean } = {}) =>
  render(
    <CookiesProvider>
    <Provider store={store}>
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route path="/start" element={<StartScreen />} />
          <Route path="/second" element={<div>second-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
    </CookiesProvider>,
    options
  );

/*
  P9d: the splash is the getMedia home_screen media (SplashMedia — rotation,
  failures and video live in its own suite). Here, the screen contract: ONE
  tap target named by the splash's one line on every layout (2026-10-16: the
  backend's start_order_text_primary, else ORDER HERE), a crash in the media
  layer contained to the static WELCOME, and the operator hotspot unaffected
  by media.
*/
describe("StartScreen — the splash (P9d)", () => {
  const seedMedia = (home_screen: unknown[]) =>
    store.dispatch(setMediaData({ media: { home_screen } }));
  const ONE = [{ url: "https://cdn.test/a.jpg" }];
  const TWO = [{ url: "https://cdn.test/a.jpg" }, { url: "https://cdn.test/b.jpg" }];
  /** The one line on a fresh store (no settings stored): the i18n fallback. */
  const ONE_LINE = /^order here$/i;
  /** WELCOME's own photo: the name no longer tells the frame from the media layouts. */
  const welcomePhoto = (button: HTMLElement) => button.querySelector('img[src*="fullbleed-halfmoon"]');

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(() => {
    crash.media = false;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("with no media stored it shows WELCOME (1:5617) named by the one line, and a tap starts the order flow", async () => {
    renderStart();

    const button = screen.getByRole("button", { name: ONE_LINE });
    expect(button).toBe(screen.getByTestId("start-screen"));
    expect(welcomePhoto(button)).toBeInTheDocument();
    expect(button).toHaveClass("tb-no-press"); // motion §3.1: the full-surface button never squeezes
    expect(screen.queryByText(/start order/i)).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.getByText("second-screen")).toBeInTheDocument();
  });

  it.each([
    ["one slide → the single card (1:2203 centre, 2026-10-13)", ONE],
    ["two slides → carousel (1:2203)", TWO],
  ])("%s: the whole screen is ONE button named by the one line; a tap starts the order", (_label, media) => {
    seedMedia(media);
    renderStart();

    const button = screen.getByRole("button", { name: ONE_LINE });
    expect(button).toBe(screen.getByTestId("start-screen"));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/start order/i)).not.toBeInTheDocument(); // the CTA is retired

    fireEvent.click(button);
    expect(screen.getByText("second-screen")).toBeInTheDocument();
  });

  it("the backend's start_order_text_primary names the button on every layout — trimmed, never the secondary", () => {
    store.dispatch(
      setKioskSettings({ start_order_text_primary: "  Tap to order  ", start_order_text_secondary: "ابدأ الطلب" })
    );
    for (const media of [[], ONE, TWO]) {
      seedMedia(media);
      const view = renderStart();
      expect(screen.getByRole("button", { name: /^Tap to order$/ })).toBe(screen.getByTestId("start-screen"));
      view.unmount();
    }
  });

  it("a render crash in the media layer shows WELCOME in place, named by the one line — no crash screen, no recovery timer — and the tap still works", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // React logs the caught error
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    crash.media = true;
    seedMedia(TWO);
    store.dispatch(setKioskSettings({ start_order_text_primary: "Tap to order" }));

    renderStart();

    const button = screen.getByRole("button", { name: /^Tap to order$/ });
    expect(welcomePhoto(button)).toBeInTheDocument();
    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
    // The global boundary would arm a 10 s / 60 s reload here.
    expect(setTimeoutSpy.mock.calls.filter(([, ms]) => (ms ?? 0) >= 10_000)).toEqual([]);

    fireEvent.click(button);
    expect(screen.getByText("second-screen")).toBeInTheDocument();
  });

  it("the operator hotspot's 3 s hold still opens the Activity Center over media — without starting an order", async () => {
    vi.useFakeTimers();
    seedMedia(TWO);
    renderStart();
    const hotspot = screen.getByTestId("activity-hotspot");

    fireEvent.mouseDown(hotspot);
    act(() => {
      vi.advanceTimersByTime(3_100);
    });
    fireEvent.mouseUp(hotspot);
    fireEvent.click(hotspot);
    await act(() => loadActivityModal()); // its lazy code (ActivityCenter)

    expect(screen.getByTestId("activity-modal")).toBeInTheDocument();
    expect(screen.queryByText("second-screen")).not.toBeInTheDocument();
  });
});

/*
  P9a (D3): every exit to the splash only NAVIGATES here; this mount ends the
  session — revoke a claimed Xeno reward FIRST (the hook reads the claim from
  its render closure), then resetSession("full"). The revoke is the raw
  cross-origin fetch, stubbed; the fetch stub snapshots the store at call
  time, which is how "before the reset" is asserted behaviourally.
*/
describe("StartScreen mount — the session teardown owner (P9a)", () => {
  interface Snapshot {
    claimed: boolean;
    cartRows: number;
  }
  const read = () =>
    store.getState() as {
      cart: { cartItems: unknown[] };
      menu: { menu: Record<string, unknown> };
      loyalty: { claimedCoupon: { isClaimed: boolean } };
    };

  /** The ledger the revoke reads (BagSheetLoyalty fixture). */
  const CLAIMED = {
    couponCode: "static6562",
    claimedPoints: 3000,
    availedCouponCode: "static6562",
    datetime: "2026-09-30%2010%3A00%3A00",
    phoneNumber: "9953833675",
    merchantId: "xeno-merchant-uuid-1",
  };

  let atRevoke: Snapshot[];
  const fetchMock = vi.fn();

  const seedSession = ({ claimed }: { claimed: boolean }) => {
    store.dispatch(
      setCartItems([
        { id: "crunchwrap", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 5 },
      ])
    );
    store.dispatch(setMenuData({ menu: { categories: [{ id: "c1" }] } }));
    if (claimed) store.dispatch(setClaimedCoupon(CLAIMED));
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    atRevoke = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => {
      atRevoke.push({
        claimed: read().loyalty.claimedCoupon.isClaimed,
        cartRows: read().cart.cartItems.length,
      });
      return { json: () => Promise.resolve({ status: "success" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("revokes a claimed reward FIRST, then runs the FULL reset", async () => {
    seedSession({ claimed: true });

    renderStart();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const uri = String(fetchMock.mock.calls[0][0]);
    expect(uri).toContain("https://xeno.in:2223/");
    expect(uri).toContain("undoRewardRedemption");
    expect(uri).toContain("rewardId=static6562");
    expect(uri).toContain("pointsToBeReturned=3000");
    // The partner was asked while the session was still intact...
    expect(atRevoke).toEqual([{ claimed: true, cartRows: 1 }]);
    // ...and the session is gone now — "full" scope also drops the menu.
    expect(read().cart.cartItems).toEqual([]);
    expect(read().menu.menu).toEqual({});
    expect(read().loyalty.claimedCoupon.isClaimed).toBe(false);
  });

  it("runs ONCE under StrictMode (the re-run keeps the claim in its closure)", () => {
    seedSession({ claimed: true });
    const dispatch = vi.spyOn(store, "dispatch");

    renderStart({ reactStrictMode: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fullResets = dispatch.mock.calls.filter(
      ([action]) => (action as { type?: string })?.type === emptyMenuData.type
    );
    expect(fullResets).toHaveLength(1);
  });

  it("with nothing claimed: no revoke call, the reset still runs", () => {
    seedSession({ claimed: false });

    renderStart();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(read().cart.cartItems).toEqual([]);
    expect(read().menu.menu).toEqual({});
  });

  it("a dead xeno.in never holds the splash (Rule 2): fire-and-forget, failure swallowed", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    seedSession({ claimed: true });

    renderStart();
    // Let the rejection settle — an unswallowed one fails the run.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("start-screen")).toBeInTheDocument();
    expect(read().cart.cartItems).toEqual([]);
    expect(read().menu.menu).toEqual({});
  });
});

/*
  audit-fixes B3 — a new PostHog session per guest. The splash mount sends
  HomeLoaded ONCE (the ref-latched teardown effect — StrictMode's replay
  included); a tap starts a new analytics session BEFORE it leaves for
  /second, so the guest's first event lands in their own session.
*/
describe("StartScreen — analytics per guest (audit-fixes B3)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mockCapture.mockReset();
    mockResetSession.mockReset();
  });

  const homeLoaded = () =>
    mockCapture.mock.calls.filter(([event]) => event === KioskEventName.HomeLoaded);

  it("HomeLoaded once per splash visit, under StrictMode too", () => {
    renderStart({ reactStrictMode: true });

    expect(homeLoaded()).toEqual([[KioskEventName.HomeLoaded]]);
    expect(mockResetSession).not.toHaveBeenCalled(); // a visit is not a guest
  });

  it("the tap resets the analytics session first, then navigates to /second", () => {
    const onScreenAtReset: boolean[] = [];
    mockResetSession.mockImplementation(() =>
      onScreenAtReset.push(screen.queryByText("second-screen") === null)
    );
    renderStart();

    fireEvent.click(screen.getByTestId("start-screen"));

    expect(mockResetSession).toHaveBeenCalledTimes(1);
    expect(onScreenAtReset).toEqual([true]); // still the splash when it ran
    expect(screen.getByText("second-screen")).toBeInTheDocument();
  });

  it("the operator's hotspot is not a guest: no reset", () => {
    renderStart();

    fireEvent.click(screen.getByTestId("activity-hotspot"));

    expect(mockResetSession).not.toHaveBeenCalled();
    expect(screen.queryByText("second-screen")).not.toBeInTheDocument();
  });
});
