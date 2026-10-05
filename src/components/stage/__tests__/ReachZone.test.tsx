import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { KioskEventName } from "@cx-sdk/core";
import {
  closeAccessibilityMode,
  setEnableAccessibilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { ReachZone } from "../ReachZone";
import {
  ADA_BRAND_ZONE_HEIGHT,
  ADA_MODAL_MAX_HEIGHT,
  ADA_REACH_ZONE_HEIGHT,
  ADA_SHEET_HEIGHT,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from "../KioskStage";
import App from "../../../App";
import i18n, { DEFAULT_LANGUAGE } from "../../../i18n";

/*
  P9c — the ADA reach-zone view. HOUSE STYLE: real store + Provider +
  MemoryRouter + RESET_STATE + i18n. The route tree is replaced by a Probe
  that stands in for the stateful pages the A2 contract protects (the PDP's
  tier-1 session, ForYou's frozen snapshot, the OrderSuccess countdown): it
  holds local state AND counts its mounts, so a remount fails twice over.

  jsdom has no layout, so geometry is asserted on the inline styles ReachZone
  owns (it sizes from the KioskStage constants, never from classes), and
  "paints above" on DOM order inside the same stacking context. Only
  analytics is mocked (captureKioskEvent is a no-op unless PostHog is up).
*/

const mockCapture = vi.fn();
const onProbeMount = vi.fn();

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

// Only the App wiring test uses these: the shell around ReachZone, not the
// real route tree (JSX runs at render time, never at hoist time).
vi.mock("../../../routes", () => ({
  AppRoutes: () => <div data-testid="app-routes" />,
}));
vi.mock("../../autoUpdate/PWAUpdateHandler", () => ({
  PWAUpdateHandler: () => null,
}));

function Probe() {
  const [taps, setTaps] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    onProbeMount();
  }, []);
  return (
    <>
      <button
        type="button"
        data-testid="probe"
        onClick={() => setTaps((n) => n + 1)}
      >
        {taps}
      </button>
      <button
        type="button"
        data-testid="probe-to-start"
        onClick={() => navigate("/start")}
      >
        start
      </button>
    </>
  );
}

const renderZone = (
  path = "/menu",
  options: { reactStrictMode?: boolean } = {}
) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <ReachZone>
          <Probe />
        </ReachZone>
      </MemoryRouter>
    </Provider>,
    options
  );

const container = () => screen.getByTestId("reach-zone");
const brandZone = () => screen.queryByTestId("ada-brand-zone");
const exitGuard = () => screen.queryByTestId("ada-exit-guard");
const adaMode = () =>
  Boolean(
    (store.getState() as { appSettings: { accessibilityMode: unknown } })
      .appSettings.accessibilityMode
  );
/** The guest's footer tap. Only ever turns the view ON here. */
const adaOn = () =>
  act(() => {
    if (!adaMode()) store.dispatch(toggleAccessibilityMode());
  });
const tapBrandZone = () => {
  const zone = brandZone();
  if (!zone) throw new Error("brand zone is not rendered");
  fireEvent.click(zone);
};

describe("ReachZone — the ADA reach-zone view (P9c, Figma 1:5392)", () => {
  beforeEach(async () => {
    store.dispatch({ type: "RESET_STATE" });
    mockCapture.mockReset();
    onProbeMount.mockReset();
    await act(async () => {
      await i18n.changeLanguage(DEFAULT_LANGUAGE);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("geometry (A1 — nothing is scaled, the app moves down)", () => {
    it("splits the stage at the calibration knob, inside the range the frameless pages were derived for", () => {
      expect(ADA_BRAND_ZONE_HEIGHT + ADA_REACH_ZONE_HEIGHT).toBe(STAGE_HEIGHT);
      // KioskStage: raising the knob past 816 collides CustomerPhone's skip
      // with the footer (Tent 822, CustomerName 837) — re-derive those first.
      expect(ADA_BRAND_ZONE_HEIGHT).toBeLessThanOrEqual(816);
      // The bag sheet leaves a scrim band to tap-to-close; centred modals
      // keep 24px top and bottom.
      expect(ADA_SHEET_HEIGHT).toBeLessThan(ADA_REACH_ZONE_HEIGHT);
      expect(ADA_MODAL_MAX_HEIGHT).toBe(ADA_REACH_ZONE_HEIGHT - 48);
    });

    it("normal mode: one full-stage container and no brand zone", () => {
      renderZone();

      expect(container()).toHaveStyle({
        width: `${STAGE_WIDTH}px`,
        height: `${STAGE_HEIGHT}px`,
      });
      expect(brandZone()).not.toBeInTheDocument();
    });

    it("ADA: the routes render into the bottom reach zone, under a brand zone that is a SIBLING, never a wrapper", () => {
      renderZone();
      adaOn();

      expect(container()).toHaveStyle({
        width: `${STAGE_WIDTH}px`,
        height: `${ADA_REACH_ZONE_HEIGHT}px`,
      });
      expect(container().className).toContain("bottom-0");
      expect(brandZone()).toHaveStyle({
        width: `${STAGE_WIDTH}px`,
        height: `${ADA_BRAND_ZONE_HEIGHT}px`,
      });
      expect(brandZone()?.className).toContain("top-0");
      expect(brandZone()?.nextElementSibling).toBe(container());
      expect(brandZone()).not.toContainElement(container());
    });

    it("is the containing block for fixed overlays in both modes (contain: layout paint)", () => {
      // OfferRemovalNotice is `fixed inset-0`: without containment it would
      // escape the zone and land under the brand panel.
      renderZone();
      expect(container().style.contain).toBe("layout paint");

      adaOn();
      expect(container().style.contain).toBe("layout paint");
    });
  });

  describe("when the view applies (A2)", () => {
    it.each(["/", "/LoadingResources", "/start"])(
      "never on %s, even with the flag on",
      (path) => {
        store.dispatch(toggleAccessibilityMode());
        renderZone(path);

        expect(brandZone()).not.toBeInTheDocument();
        expect(container()).toHaveStyle({ height: `${STAGE_HEIGHT}px` });
      }
    );

    it("never while the tenant has the feature off: a stale guest flag cannot strand anyone", () => {
      store.dispatch(toggleAccessibilityMode());
      store.dispatch(setEnableAccessibilityMode(false));
      renderZone();

      expect(brandZone()).not.toBeInTheDocument();
      expect(container()).toHaveStyle({ height: `${STAGE_HEIGHT}px` });
    });

    it("an exit to the splash is full-stage in that same render, before /start's mount reset closes the flag", () => {
      renderZone("/menu");
      adaOn();
      expect(brandZone()).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("probe-to-start"));

      // Nothing has reset yet (hazard H1: exits only navigate)...
      expect(adaMode()).toBe(true);
      // ...and the splash still never paints inside the zone.
      expect(brandZone()).not.toBeInTheDocument();
      expect(container()).toHaveStyle({ height: `${STAGE_HEIGHT}px` });
    });
  });

  describe("a toggle never remounts the routes (A2)", () => {
    it("keeps their state and their container node across ADA on, the brand-zone exit and a tenant-gate flip", () => {
      renderZone();
      fireEvent.click(screen.getByTestId("probe"));
      fireEvent.click(screen.getByTestId("probe"));
      const node = container();

      adaOn();
      expect(container()).toBe(node);
      expect(container()).toHaveStyle({ height: `${ADA_REACH_ZONE_HEIGHT}px` });

      tapBrandZone();
      expect(container()).toBe(node);

      adaOn();
      act(() => {
        store.dispatch(setEnableAccessibilityMode(false));
      });
      expect(container()).toBe(node);
      expect(container()).toHaveStyle({ height: `${STAGE_HEIGHT}px` });

      expect(screen.getByTestId("probe")).toHaveTextContent("2");
      expect(onProbeMount).toHaveBeenCalledTimes(1);
    });
  });

  describe("the brand zone is the way out (A3 — tap-to-exit, fork parity)", () => {
    it("is one labelled button that closes ADA and hands the stage back", () => {
      renderZone();
      adaOn();

      const exit = screen.getByRole("button", { name: i18n.t("ada.exit") });
      expect(exit).toBe(brandZone());
      expect(i18n.t("ada.exit")).toBe("Exit ADA display");

      fireEvent.click(exit);

      expect(adaMode()).toBe(false);
      expect(brandZone()).not.toBeInTheDocument();
      expect(container()).toHaveStyle({ height: `${STAGE_HEIGHT}px` });
    });

    it("is labelled in Arabic too", async () => {
      const arabic = i18n.getFixedT("ar")("ada.exit");
      // A real translation, not the key or the English fallback.
      expect(arabic).not.toBe("ada.exit");
      expect(arabic).not.toBe("Exit ADA display");

      renderZone();
      adaOn();
      await act(async () => {
        await i18n.changeLanguage("ar");
      });

      expect(brandZone()).toHaveAccessibleName(arabic);
    });

    it("guards the vacated panel for 500 ms, so a double tap's second half cannot land on the page", () => {
      vi.useFakeTimers();
      renderZone();
      adaOn();

      tapBrandZone();

      const guard = exitGuard();
      expect(guard).toBeInTheDocument();
      // Exactly the panel area, hit-testable, and after the container so it
      // paints above the now full-height page.
      expect(guard).toHaveStyle({
        width: `${STAGE_WIDTH}px`,
        height: `${ADA_BRAND_ZONE_HEIGHT}px`,
      });
      expect(guard?.className).not.toContain("pointer-events-none");
      expect(container().nextElementSibling).toBe(guard);

      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(exitGuard()).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(exitGuard()).not.toBeInTheDocument();
    });

    it("clears the guard's timer on unmount (Rule 5)", () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(window, "setTimeout");
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
      const { unmount } = renderZone();
      adaOn();

      tapBrandZone();
      const index = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === 500);
      expect(index).toBeGreaterThanOrEqual(0);
      const timerId = setTimeoutSpy.mock.results[index].value;

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
    });
  });

  describe("analytics (A4 — fork App.tsx parity)", () => {
    it.each([false, true])(
      "reports nothing for the value the app booted with (%s), StrictMode included",
      (booted) => {
        if (booted) store.dispatch(toggleAccessibilityMode());
        renderZone("/menu", { reactStrictMode: true });

        expect(mockCapture).not.toHaveBeenCalled();
      }
    );

    it("reports exactly one event per flip of the flag", () => {
      renderZone("/menu", { reactStrictMode: true });

      adaOn();
      tapBrandZone();
      // closeAccessibilityMode is idempotent: a repeat close is no flip.
      act(() => {
        store.dispatch(closeAccessibilityMode());
      });

      expect(mockCapture.mock.calls).toEqual([
        [
          KioskEventName.AccessibilityOptionSelected,
          { accessibility_mode_enabled: true },
        ],
        [
          KioskEventName.AccessibilityOptionDeselected,
          { accessibility_mode_enabled: false },
        ],
      ]);
    });

    it("reports the reset that closes ADA on /start, where the view itself never shows", () => {
      store.dispatch(toggleAccessibilityMode()); // carried to the splash
      renderZone("/start");

      act(() => {
        store.dispatch(closeAccessibilityMode()); // resetSession("full")
      });

      expect(mockCapture.mock.calls).toEqual([
        [
          KioskEventName.AccessibilityOptionDeselected,
          { accessibility_mode_enabled: false },
        ],
      ]);
    });
  });

  it("App mounts it as Router > KioskStage > ReachZone > routes", () => {
    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(container().parentElement).toBe(screen.getByTestId("kiosk-stage"));
    expect(container()).toContainElement(screen.getByTestId("app-routes"));
  });
});
