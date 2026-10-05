import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense, lazy, type ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Provider } from "react-redux";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import {
  initiateWholeAppUpdate,
  markAsUpdateDone,
  receivedUpdateNotif,
  setLastBootAt,
  setLastRefreshFailedAt,
} from "@cx-sdk/devices/updates/autoUpdate.slice";
import {
  BOOT_DATA_MAX_AGE_MS,
  BOOT_REFRESH_RETRY_MS,
} from "@cx-sdk/devices/updates/updatePolicy";
import { store } from "../../../redux/app/store";
import StartScreen from "../index";
import "../../../i18n";

/*
  P9e — the splash is the ONLY place updates apply (never mid-order). Pending,
  by precedence: a new build (whole_app) > an FCM brand push (brand) > boot
  data older than 6 h or a failed refresh past its 30 min backoff (scheduled).
  Armed only while online and the Activity Center is closed: 10 s invisible,
  a 5 s non-dismissable countdown, then ONE apply. The update hook is mocked
  (the ack hangs: it must never be awaited); navigate() is recorded while the
  real router still routes, and /LoadingResources prints its route state.
  Every test starts from a booted kiosk with FRESH boot data.
  Clock rule: act() renders only when its callback returns, so a timer an
  effect arms after a re-render (the due-instant re-check, the dwell) exists
  only from that act's end — step the clock ONTO each due instant.
*/

const h = vi.hoisted(() => ({
  ack: vi.fn(),
  applyWholeApp: vi.fn(),
  navigate: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("../../../hooks/autoUpdates/useAutoUpdate", () => ({
  default: () => ({
    updateDeviceUpdateStatus: h.ack,
    applyWholeAppUpdate: h.applyWholeApp,
  }),
}));
// The Activity Center's logout hook (react-cookie: its 300 ms cookie poll
// would be one more live timer).
vi.mock("../../../hooks/utils/useAuthHook", () => ({
  default: () => ({ logoutKiosk: () => {} }),
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => h.capture(...args),
}));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate() as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        h.navigate(...args);
        return navigate(...args);
      };
    },
  };
});

const T0 = new Date("2026-10-05T12:00:00Z").getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function RefreshProbe() {
  const { state } = useLocation();
  return <div data-testid="refresh-probe">{JSON.stringify(state)}</div>;
}
/** A /LoadingResources that never finishes loading: the navigation stays pending. */
const NeverLoads = lazy(() => new Promise<{ default: () => null }>(() => {}));

const renderStart = ({
  reactStrictMode = false,
  refreshRoute = <RefreshProbe />,
}: { reactStrictMode?: boolean; refreshRoute?: ReactElement } = {}) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/start"]}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/start" element={<StartScreen />} />
            <Route path="/second" element={<div>second-screen</div>} />
            <Route path="/LoadingResources" element={refreshRoute} />
          </Routes>
        </Suspense>
      </MemoryRouter>
    </Provider>,
    { reactStrictMode }
  );

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
/** Whole minutes in one-minute acts: every due instant here is on a minute. */
const advanceMinutes = (minutes: number) => {
  for (let i = 0; i < minutes; i += 1) tick(MINUTE);
};
const countdown = () => screen.queryByTestId("update-countdown");
const status = () =>
  screen.queryByTestId("update-countdown-status")?.textContent ?? null;
const refreshState = (): unknown =>
  JSON.parse(screen.getByTestId("refresh-probe").textContent ?? "");
const refreshNavigations = () =>
  h.navigate.mock.calls.filter(([to]) => to === "/LoadingResources");
const refreshTo = (trigger: string) => [
  "/LoadingResources",
  { state: { refresh: true, trigger } },
];
const updateEvents = () =>
  h.capture.mock.calls
    .filter(([name]) => name === "update_triggered")
    .map(([, props]) => props);
/** The hidden 3 s operator hold on the top-left hotspot. */
const holdHotspot = () => {
  const hotspot = screen.getByTestId("activity-hotspot");
  fireEvent.mouseDown(hotspot);
  tick(3_000);
  fireEvent.mouseUp(hotspot);
};

const seedStale = () => store.dispatch(setLastBootAt(T0 - BOOT_DATA_MAX_AGE_MS));
const seedBrand = () =>
  store.dispatch(
    receivedUpdateNotif({ shouldBrandUpdate: true, device_update_id: "upd-1" })
  );
const seedWholeApp = () => store.dispatch(initiateWholeAppUpdate());

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" }); // before the fake clock: persistence schedules a write
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  store.dispatch(setPipelines([{ _id: "pipeline-1", name: "Dine In" }]));
  store.dispatch(setLastBootAt(T0));
  h.ack.mockReset();
  h.ack.mockReturnValue(new Promise(() => {})); // never settles — never awaited
  h.applyWholeApp.mockReset();
  h.navigate.mockReset();
  h.capture.mockReset();
});

afterEach(() => {
  cleanup(); // while the fake clock is still installed
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("StartScreen — the dwell and the apply", () => {
  it("fresh data, nothing pending: 60 s untouched → nothing arms; only the ≤15 min re-check timer exists", () => {
    renderStart();
    tick(60_000);

    expect(countdown()).toBeNull();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(updateEvents()).toEqual([]);
    expect(vi.getTimerCount()).toBe(1); // no 1 Hz dwell while disarmed (Rule 5)
  });

  it("scheduled (data 6 h old): invisible 0–10 s, a 5 → 1 countdown 10–15 s, then ONE refresh-mode navigate — no ack", () => {
    seedStale();
    renderStart();

    tick(9_999);
    expect(countdown()).toBeNull();
    tick(1);
    expect(status()).toBe("Starting in 5s");
    for (const seconds of [4, 3, 2, 1]) {
      tick(1_000);
      expect(status()).toBe(`Starting in ${seconds}s`);
    }
    expect(h.navigate).not.toHaveBeenCalled();

    tick(1_000);
    expect(h.navigate.mock.calls).toEqual([refreshTo("scheduled")]);
    expect(refreshState()).toEqual({ refresh: true, trigger: "scheduled" });
    expect(h.ack).not.toHaveBeenCalled();
    expect(h.applyWholeApp).not.toHaveBeenCalled();
    expect(updateEvents()).toEqual([{ update_type: "scheduled" }]);

    tick(60_000);
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(updateEvents()).toHaveLength(1);
  });

  it.each([
    ["whole_app beats a brand push and stale data", () => (seedWholeApp(), seedBrand(), seedStale()), "whole_app"],
    ["whole_app beats stale data", () => (seedWholeApp(), seedStale()), "whole_app"],
    ["brand beats stale data", () => (seedBrand(), seedStale()), "brand"],
    ["stale data alone → scheduled", seedStale, "scheduled"],
  ])("precedence: %s", (_label, seed, kind) => {
    seed();
    renderStart();
    tick(15_000);

    expect(updateEvents()).toEqual([{ update_type: kind }]);
    expect(h.applyWholeApp).toHaveBeenCalledTimes(kind === "whole_app" ? 1 : 0);
    expect(h.ack).toHaveBeenCalledTimes(kind === "brand" ? 1 : 0);
    expect(refreshNavigations()).toEqual(kind === "whole_app" ? [] : [refreshTo(kind)]);
  });

  it("whole_app → applyWholeAppUpdate() once at 15 s; no ack (the brand flag survives the reload), no navigate; 'Updating…' stays", () => {
    seedWholeApp();
    seedBrand();
    renderStart();
    tick(14_999);
    expect(h.applyWholeApp).not.toHaveBeenCalled();

    tick(1);
    expect(h.applyWholeApp.mock.calls).toEqual([[]]);
    expect(h.ack).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(store.getState().autoUpdate.shouldBrandUpdate).toBe(true);
    expect(status()).toBe("Updating…");

    tick(60_000);
    expect(h.applyWholeApp).toHaveBeenCalledTimes(1);
    expect(updateEvents()).toEqual([{ update_type: "whole_app" }]);
  });

  it("brand → the ack fires first and is NOT awaited (here it never settles); the refresh navigates in the same tick, trigger 'brand'", () => {
    seedBrand();
    renderStart();
    tick(15_000);

    expect(h.ack).toHaveBeenCalledTimes(1);
    expect(h.navigate.mock.calls).toEqual([refreshTo("brand")]);
    expect(h.ack.mock.invocationCallOrder[0]).toBeLessThan(
      h.navigate.mock.invocationCallOrder[0]
    );
    expect(refreshState()).toEqual({ refresh: true, trigger: "brand" });
    expect(updateEvents()).toEqual([{ update_type: "brand" }]);
  });

  it("brand: once applying, 'Updating…' stays up after the ack lowers the flag, while the refresh route is still loading (latch)", () => {
    seedBrand();
    h.ack.mockImplementation(() => {
      store.dispatch(markAsUpdateDone()); // the real hook lowers the flag synchronously, first
      return new Promise(() => {});
    });
    renderStart({ refreshRoute: <NeverLoads /> });
    tick(15_000);

    expect(store.getState().autoUpdate.shouldBrandUpdate).toBe(false);
    expect(screen.getByTestId("start-screen")).toBeInTheDocument(); // navigation pending
    expect(status()).toBe("Updating…");

    tick(60_000);
    expect(status()).toBe("Updating…");
    expect(h.ack).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(updateEvents()).toHaveLength(1);
  });

  it.each([
    ["the dwell (stale data)", () => (seedStale(), renderStart(), tick(15_000))],
    [
      "the operator's Reload resources",
      () => {
        renderStart();
        holdHotspot();
        fireEvent.click(screen.getByTestId("activity-reload-resources"));
      },
    ],
  ])("OV4 — no pipelines stored: %s navigates in NORMAL mode (no route state → the boot's retry ladder)", (_label, run) => {
    store.dispatch(setPipelines([]));
    run();

    expect(h.navigate.mock.calls).toEqual([["/LoadingResources", undefined]]);
    expect(refreshState()).toBeNull();
  });
});

describe("StartScreen — what defers, pauses or disarms the dwell", () => {
  it("a guest tap at 9.999 s (nothing visible yet) goes to /second; the update is deferred — nothing applies, no timer survives", () => {
    seedStale();
    seedBrand();
    renderStart();
    tick(9_999);

    fireEvent.click(screen.getByTestId("start-screen"));

    expect(screen.getByText("second-screen")).toBeInTheDocument();
    expect(h.navigate.mock.calls).toEqual([["/second"]]);
    tick(60_000);
    expect(refreshNavigations()).toEqual([]);
    expect(h.ack).not.toHaveBeenCalled();
    expect(updateEvents()).toEqual([]);
    expect(store.getState().autoUpdate.shouldBrandUpdate).toBe(true); // waits for the next splash visit
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the visible countdown is non-dismissable: a tap on it never reaches the splash, and the apply still lands at 15 s", () => {
    seedStale();
    renderStart();
    tick(12_000);

    fireEvent.click(screen.getByTestId("update-countdown"));
    fireEvent.click(screen.getByText("Starting in 3s"));

    expect(screen.queryByText("second-screen")).toBeNull();
    tick(3_000);
    expect(h.navigate.mock.calls).toEqual([refreshTo("scheduled")]);
  });

  it("offline → nothing arms (60 s); back online → a FULL 15 s dwell", () => {
    seedStale();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderStart();
    tick(60_000);
    expect(countdown()).toBeNull();
    expect(h.navigate).not.toHaveBeenCalled();

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    tick(9_999);
    expect(countdown()).toBeNull();
    tick(1);
    expect(status()).toBe("Starting in 5s");
    tick(5_000);
    expect(h.navigate.mock.calls).toEqual([refreshTo("scheduled")]);
  });

  it("going offline mid-countdown disarms at once; back online re-arms a FULL 15 s", () => {
    seedBrand();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    renderStart();
    tick(12_000);
    expect(status()).toBe("Starting in 3s");

    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(countdown()).toBeNull();
    tick(60_000);
    expect(h.ack).not.toHaveBeenCalled();

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    tick(14_999);
    expect(h.navigate).not.toHaveBeenCalled();
    tick(1);
    expect(h.ack).toHaveBeenCalledTimes(1);
    expect(h.navigate.mock.calls).toEqual([refreshTo("brand")]);
  });

  it("the Activity Center pauses the dwell (60 s: nothing); closing it re-arms a FULL 15 s", () => {
    seedStale();
    renderStart();
    tick(5_000);
    holdHotspot(); // opens at 8 s
    expect(screen.getByTestId("activity-modal")).toBeInTheDocument();

    tick(60_000);
    expect(countdown()).toBeNull();
    expect(h.navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("activity-close"));
    tick(9_999);
    expect(countdown()).toBeNull();
    tick(1);
    expect(status()).toBe("Starting in 5s");
    tick(5_000);
    expect(h.navigate.mock.calls).toEqual([refreshTo("scheduled")]);
  });

  it.each([
    ["mid-countdown (the 1 Hz dwell)", seedStale, 12_000],
    ["with only the ≤15 min re-check pending (fresh data)", () => {}, 1_000],
  ])("unmount %s leaves no timer behind", (_label, seed, after) => {
    seed();
    const view = renderStart();
    tick(after);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("StartScreen — when the scheduled refresh falls due (D1 clock)", () => {
  it("data turning stale while the splash is up (boot 5 h 59 m 50 s ago): armed 10 s later — countdown at 20 s, refresh at 25 s", () => {
    store.dispatch(setLastBootAt(T0 - BOOT_DATA_MAX_AGE_MS + 10_000));
    renderStart();

    tick(9_999);
    tick(1); // the due instant: the re-check fires and arms the dwell
    tick(9_999);
    expect(countdown()).toBeNull();
    tick(1);
    expect(status()).toBe("Starting in 5s");
    tick(4_999);
    expect(h.navigate).not.toHaveBeenCalled();
    tick(1);
    expect(h.navigate.mock.calls).toEqual([refreshTo("scheduled")]);
  });

  it("idling on the splash from a fresh boot: the refresh lands exactly 6 h + 15 s later (the capped re-check re-arms itself)", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    renderStart();
    expect(setTimeoutSpy.mock.calls.map(([, ms]) => ms)).toContain(15 * MINUTE); // min(6 h, 15 min)

    advanceMinutes(BOOT_DATA_MAX_AGE_MS / MINUTE); // armed at exactly 6 h
    tick(14_999);
    expect(h.navigate).not.toHaveBeenCalled();
    tick(1);
    expect(h.navigate.mock.calls).toEqual([refreshTo("scheduled")]);
  });

  it("a forward clock jump (NTP/RTC) is noticed at the next ≤15 min re-check", () => {
    renderStart();
    vi.setSystemTime(T0 + 7 * HOUR); // the wall clock jumps; no timer runs

    tick(15 * MINUTE - 1);
    expect(countdown()).toBeNull();
    tick(1); // the re-check reads the jumped clock → stale → armed
    tick(14_999);
    expect(h.navigate).not.toHaveBeenCalled();
    tick(1);
    expect(h.navigate.mock.calls).toEqual([refreshTo("scheduled")]);
  });

  it.each([
    ["fresh data (booted 1 h ago): a failed brand/operator refresh is retried", T0 - HOUR],
    ["stale data: no hot loop — the next attempt waits out the backoff", T0 - BOOT_DATA_MAX_AGE_MS],
  ])("a refresh that failed 10 min ago → %s 30 min after the failure", (_label, lastBootAt) => {
    store.dispatch(setLastBootAt(lastBootAt));
    store.dispatch(setLastRefreshFailedAt(T0 - 10 * MINUTE));
    renderStart();
    advanceMinutes((BOOT_REFRESH_RETRY_MS - 10 * MINUTE) / MINUTE); // re-check at 15, due at 20 min
    tick(14_999);
    expect(h.navigate).not.toHaveBeenCalled();
    tick(1);
    expect(h.navigate.mock.calls).toEqual([refreshTo("scheduled")]);
  });
});

describe("StartScreen — the operator and StrictMode", () => {
  it("the operator's Reload resources (3 s hidden hold) refreshes with trigger 'operator' on fresh data — no update_triggered, no ack", () => {
    renderStart();
    holdHotspot();

    fireEvent.click(screen.getByTestId("activity-reload-resources"));

    expect(h.navigate.mock.calls).toEqual([refreshTo("operator")]);
    expect(refreshState()).toEqual({ refresh: true, trigger: "operator" });
    expect(updateEvents()).toEqual([]);
    expect(h.ack).not.toHaveBeenCalled();
  });

  it.each([
    ["brand", seedBrand],
    ["whole_app", seedWholeApp],
    ["scheduled", seedStale],
  ])("StrictMode (%s): ONE apply — one event, one ack/reload/navigate", (kind, seed) => {
    seed();
    renderStart({ reactStrictMode: true });
    tick(15_000);
    tick(60_000);

    expect(updateEvents()).toEqual([{ update_type: kind }]);
    expect(h.ack).toHaveBeenCalledTimes(kind === "brand" ? 1 : 0);
    expect(h.applyWholeApp).toHaveBeenCalledTimes(kind === "whole_app" ? 1 : 0);
    expect(refreshNavigations()).toEqual(kind === "whole_app" ? [] : [refreshTo(kind)]);
  });
});
