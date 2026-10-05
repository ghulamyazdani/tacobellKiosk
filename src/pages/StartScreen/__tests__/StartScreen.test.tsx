import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { CookiesProvider } from "react-cookie";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import { emptyMenuData, setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { setMediaData } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import StartScreen from "../index";
import "../../../i18n";

/** Flip `crash.media` to make the media layer throw during render. */
const { crash } = vi.hoisted(() => ({ crash: { media: false } }));

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
  tap target named by the visible copy of whichever layout shows, a crash in
  the media layer contained to the static WELCOME, and the operator hotspot
  unaffected by media.
*/
describe("StartScreen — the splash (P9d)", () => {
  const seedMedia = (home_screen: unknown[]) =>
    store.dispatch(setMediaData({ media: { home_screen } }));
  const ONE = [{ url: "https://cdn.test/a.jpg" }];
  const TWO = [{ url: "https://cdn.test/a.jpg" }, { url: "https://cdn.test/b.jpg" }];
  const WELCOME_NAME = /^welcome\s*touch anywhere to start$/i;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(() => {
    crash.media = false;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("with no media stored it shows WELCOME (1:5617), and a tap starts the order flow", async () => {
    renderStart();

    const button = screen.getByRole("button", { name: WELCOME_NAME });
    expect(button).toBe(screen.getByTestId("start-screen"));
    expect(screen.queryByText(/start order/i)).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.getByText("second-screen")).toBeInTheDocument();
  });

  it.each([
    ["one slide → full-bleed (1:5604)", ONE, /^start order$/i],
    ["two slides → carousel (1:2203)", TWO, /^order here\s*start order$/i],
  ])("%s: the whole screen is ONE button named by its visible copy; a tap starts the order", (_label, media, name) => {
    seedMedia(media);
    renderStart();

    const button = screen.getByRole("button", { name });
    expect(button).toBe(screen.getByTestId("start-screen"));
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(button);
    expect(screen.getByText("second-screen")).toBeInTheDocument();
  });

  it("a render crash in the media layer shows WELCOME in place — no crash screen, no recovery timer — and the tap still works", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // React logs the caught error
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    crash.media = true;
    seedMedia(TWO);

    renderStart();

    const button = screen.getByRole("button", { name: WELCOME_NAME });
    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
    // The global boundary would arm a 10 s / 60 s reload here.
    expect(setTimeoutSpy.mock.calls.filter(([, ms]) => (ms ?? 0) >= 10_000)).toEqual([]);

    fireEvent.click(button);
    expect(screen.getByText("second-screen")).toBeInTheDocument();
  });

  it("the operator hotspot's 3 s hold still opens the Activity Center over media — without starting an order", () => {
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
