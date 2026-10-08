import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { setMandatoryFullscreen } from "@cx-sdk/catalog/state/appSettings.slice";
import { setToken } from "@cx-sdk/core/auth/authentication.slice";
import { KioskEventName } from "@cx-sdk/core";
import { store } from "../../../redux/app/store";
import FullscreenGate, {
  FULLSCREEN_FILL_TOLERANCE_PX,
  isFullscreenLocked,
} from "../FullscreenGate";
import i18n from "../../../i18n";

/*
  audit-fixes U2 — the fullscreen lock. jsdom has no Fullscreen API and a
  0×0 screen (a window that "fills" it counts as locked), so each test shapes
  the platform by hand: the window 1080×1920, its screen 1080×2000 (a
  windowed browser), `document.fullscreenElement`, `requestFullscreen` and
  `fullscreenEnabled` — and fires fullscreenchange / resize as the browser
  would. Every override is restored afterwards (jsdom keeps innerWidth /
  innerHeight as OWN window properties, so a plain delete would lose them).
*/

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const overridden: Array<[object, string, PropertyDescriptor | undefined]> = [];
const override = (target: object, key: string, descriptor: PropertyDescriptor) => {
  overridden.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
};
const define = (target: object, key: string, value: unknown) =>
  override(target, key, { writable: true, value });

let fullscreenElement: Element | null = null;
const setFullscreenElement = (element: Element | null) => {
  fullscreenElement = element;
};

/** A windowed browser: the 1080×1920 window on a taller 1080×2000 screen. */
const windowed = () => {
  define(window, "innerWidth", 1080);
  define(window, "innerHeight", 1920);
  define(window.screen, "width", 1080);
  define(window.screen, "height", 2000);
};

const registered = () => store.dispatch(setToken("mock-device-token"));

const mount = () =>
  render(
    <Provider store={store}>
      <FullscreenGate />
    </Provider>
  );

const gate = () => screen.queryByTestId("fullscreen-gate");

const fire = (target: EventTarget, type: string) =>
  act(() => {
    target.dispatchEvent(new Event(type));
  });

const tap = async () => {
  const button = gate();
  if (!button) throw new Error("the gate is not up");
  await act(async () => {
    fireEvent.click(button);
  });
};

const events = (name: KioskEventName) =>
  mockCapture.mock.calls.filter(([event]) => event === name).map(([, props]) => props);

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  mockCapture.mockReset();
  fullscreenElement = null;
  override(document, "fullscreenElement", { get: () => fullscreenElement });
});

afterEach(() => {
  // Newest first, so a key overridden twice gets its original back.
  for (const [target, key, original] of overridden.splice(0).reverse()) {
    if (original) Object.defineProperty(target, key, original);
    else delete (target as Record<string, unknown>)[key];
  }
  vi.restoreAllMocks();
});

describe("FullscreenGate — when it shows (audit-fixes U2)", () => {
  it("a registered kiosk, mandatory fullscreen on, a windowed browser: ONE full-window button named by its copy, a portal in body at z-[99998]", () => {
    windowed();
    registered();
    mount();

    // jsdom computes no flex layout, so the two lines join without a space.
    const button = screen.getByRole("button", {
      name: `${i18n.t("fullscreen.title")}${i18n.t("fullscreen.body")}`,
    });
    expect(button).toBe(gate());
    expect(button.parentElement).toBe(document.body);
    expect(button).toHaveClass("fixed", "inset-0", "z-[99998]", "bg-tb-purple/95", "tb-fade-in");
    expect(button).toHaveTextContent(/^TAP TO CONTINUE/);
  });

  it("nothing before registration (no token) — Registration is never gated", () => {
    windowed();
    mount();
    expect(gate()).toBeNull();
  });

  it("nothing while the operator has mandatory fullscreen off, and it follows the toggle both ways", () => {
    windowed();
    registered();
    store.dispatch(setMandatoryFullscreen(false));
    mount();
    expect(gate()).toBeNull();

    act(() => {
      store.dispatch(setMandatoryFullscreen(true));
    });
    expect(gate()).not.toBeNull();

    act(() => {
      store.dispatch(setMandatoryFullscreen(false));
    });
    expect(gate()).toBeNull();
  });

  it("nothing in jsdom's own 0×0 screen: a window that fills its screen is locked", () => {
    registered();
    mount();
    expect(isFullscreenLocked()).toBe(true);
    expect(gate()).toBeNull();
  });

  it("nothing where the browser disallows fullscreen (fullscreenEnabled false) — never a gate that cannot open", () => {
    windowed();
    registered();
    define(document, "fullscreenEnabled", false);
    mount();
    expect(gate()).toBeNull();
  });

  it("nothing while an element is fullscreen, or the browser runs in display-mode fullscreen (F11)", () => {
    windowed();
    registered();
    setFullscreenElement(document.documentElement);
    const first = mount();
    expect(gate()).toBeNull();
    first.unmount();

    setFullscreenElement(null);
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query === "(display-mode: fullscreen)" }) as MediaQueryList
    );
    mount();
    expect(gate()).toBeNull();
  });

  it(`a window within ${FULLSCREEN_FILL_TOLERANCE_PX} px of its screen counts as filling it (fractional pixel ratios); one more pixel short does not`, () => {
    windowed();
    expect(FULLSCREEN_FILL_TOLERANCE_PX).toBe(2);
    define(window, "innerHeight", 2000 - FULLSCREEN_FILL_TOLERANCE_PX);
    expect(isFullscreenLocked()).toBe(true);
    define(window, "innerHeight", 2000 - FULLSCREEN_FILL_TOLERANCE_PX - 1);
    expect(isFullscreenLocked()).toBe(false);
    define(window, "innerHeight", 2000);
    define(window, "innerWidth", 1080 - FULLSCREEN_FILL_TOLERANCE_PX - 1);
    expect(isFullscreenLocked()).toBe(false);
  });
});

describe("FullscreenGate — a tap (audit-fixes U2)", () => {
  it("enters fullscreen once and reports FullScreenEnabled; the browser's fullscreenchange takes the gate down", async () => {
    windowed();
    registered();
    const requestFullscreen = vi.fn(() => Promise.resolve());
    define(document.documentElement, "requestFullscreen", requestFullscreen);
    mount();

    await tap();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(KioskEventName.FullScreenEnabled);
    expect(events(KioskEventName.ErrorOccurred)).toEqual([]);

    setFullscreenElement(document.documentElement);
    fire(document, "fullscreenchange");
    expect(gate()).toBeNull();
  });

  it("a refusal never blocks the guest: the gate goes for this page load, the failure is reported, and the next page load re-arms it", async () => {
    windowed();
    registered();
    define(
      document.documentElement,
      "requestFullscreen",
      vi.fn(() => Promise.reject(new TypeError("Permissions check failed")))
    );
    const view = mount();

    await tap();

    expect(gate()).toBeNull();
    expect(mockCapture).toHaveBeenCalledWith(KioskEventName.ErrorOccurred, {
      error_source: "fullscreen",
      error_message: "Permissions check failed",
    });
    expect(events(KioskEventName.FullScreenEnabled)).toEqual([]);

    // Still windowed, still down: a resize recheck does not bring it back.
    fire(window, "resize");
    expect(gate()).toBeNull();

    view.unmount(); // the next page load
    mount();
    expect(gate()).not.toBeNull();
  });

  it("no Fullscreen API at all (jsdom's own state): fails open and reports it", async () => {
    windowed();
    registered();
    mount();
    expect(typeof document.documentElement.requestFullscreen).toBe("undefined");

    await tap();

    expect(gate()).toBeNull();
    expect(mockCapture).toHaveBeenCalledWith(KioskEventName.ErrorOccurred, {
      error_source: "fullscreen",
      error_message: "Fullscreen API unavailable",
    });
  });
});

describe("FullscreenGate — it follows the window (audit-fixes U2)", () => {
  it("leaving fullscreen (fullscreenchange back to null) brings the gate back", () => {
    windowed();
    registered();
    setFullscreenElement(document.documentElement);
    mount();
    expect(gate()).toBeNull();

    setFullscreenElement(null);
    fire(document, "fullscreenchange");
    expect(gate()).not.toBeNull();
  });

  it("a resize that makes the window fill its screen (--kiosk, F11) takes it down; shrinking brings it back", () => {
    windowed();
    registered();
    mount();
    expect(gate()).not.toBeNull();

    define(window, "innerHeight", 2000);
    fire(window, "resize");
    expect(gate()).toBeNull();

    define(window, "innerHeight", 1920);
    fire(window, "resize");
    expect(gate()).not.toBeNull();
  });

  it("unmount removes both listeners it added (Rule 5)", () => {
    const docAdd = vi.spyOn(document, "addEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");
    const view = mount();

    const added = (spy: typeof docAdd, type: string) =>
      spy.mock.calls.filter(([t]) => t === type).map(([, handler]) => handler);
    const onChange = added(docAdd, "fullscreenchange");
    const onResize = added(winAdd, "resize");
    expect(onChange).toHaveLength(1);
    expect(onResize).toHaveLength(1);

    view.unmount();

    expect(added(docRemove, "fullscreenchange")).toEqual(onChange);
    expect(added(winRemove, "resize")).toEqual(onResize);
  });
});
