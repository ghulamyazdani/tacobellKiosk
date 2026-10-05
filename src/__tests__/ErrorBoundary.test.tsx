import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";
import i18n from "../i18n";

/*
  P9b R9 — the app-level crash screen recovers an unattended kiosk by itself.
  Seams: reloadTo (a full page load — the boundary sits above the Router, and
  jsdom cannot navigate), analytics, and navigator.onLine. The plan itself is
  the REAL planCrashRecovery, fed the page age through performance.now() — so
  only setTimeout/clearTimeout are faked here.
*/

const { mockReload, mockCapture, mockPlan } = vi.hoisted(() => ({
  mockReload: vi.fn(),
  mockCapture: vi.fn(),
  mockPlan: vi.fn(),
}));

vi.mock("../utils/chunkRecovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/chunkRecovery")>();
  return {
    ...actual,
    reloadTo: (path: string) => mockReload(path),
    // Recorded, but still the REAL plan.
    planCrashRecovery: (...args: Parameters<typeof actual.planCrashRecovery>) => {
      mockPlan(...args);
      return actual.planCrashRecovery(...args);
    },
  };
});

vi.mock("../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

function Boom(): never {
  throw new Error("render crash in a child");
}

let online = true;

/** Crash `pageAgeMs` after the page loaded. */
const crash = (pageAgeMs: number) => {
  vi.spyOn(performance, "now").mockReturnValue(pageAgeMs);
  return render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>
  );
};

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const HEALTHY = 120_000;
const YOUNG = 5_000;

describe("ErrorBoundary — the crash screen recovers by itself (P9b R9)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockReload.mockReset();
    mockCapture.mockReset();
    mockPlan.mockReset();
    online = true;
    vi.spyOn(window.navigator, "onLine", "get").mockImplementation(() => online);
    // React reports every caught render error on console.error.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("renders healthy children untouched", () => {
    render(
      <ErrorBoundary>
        <p>menu</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("menu")).toBeInTheDocument();
    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
  });

  it("a crash shows the translated dialog INSIDE the kiosk stage — never the developer's error text", () => {
    crash(HEALTHY);

    const stage = screen.getByTestId("kiosk-stage");
    const dialog = within(stage).getByTestId("app-error");
    expect(dialog).toHaveAttribute("role", "alertdialog");
    expect(dialog).toHaveAccessibleName(i18n.t("errorBoundary.title"));
    expect(dialog).toHaveAccessibleDescription(i18n.t("errorBoundary.message"));
    expect(screen.getByTestId("app-error-start-over")).toHaveTextContent(
      i18n.t("errorBoundary.startOver")
    );
    expect(screen.queryByText(/render crash/)).not.toBeInTheDocument();
  });

  it("uses the language in force at the crash (AR)", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    crash(HEALTHY);

    expect(screen.getByTestId("app-error")).toHaveAccessibleName("حدث خطأ ما");
    expect(screen.getByTestId("app-error-start-over")).toHaveTextContent(
      "البدء من جديد"
    );
  });

  it("a crash on a healthy page reloads to /start after exactly 10 s — once", () => {
    crash(HEALTHY);

    advance(9_999);
    expect(mockReload).not.toHaveBeenCalled();

    advance(1);
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockReload).toHaveBeenCalledWith("/start");

    advance(120_000);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("a crash within a minute of loading (a probable loop) re-boots via /LoadingResources after 60 s", () => {
    crash(YOUNG);

    advance(59_999);
    expect(mockReload).not.toHaveBeenCalled();

    advance(1);
    expect(mockReload).toHaveBeenCalledWith("/LoadingResources");
  });

  it("a crash ON the boot screen re-boots rather than skipping to /start", () => {
    window.history.replaceState(null, "", "/LoadingResources");
    crash(HEALTHY);

    advance(60_000);
    expect(mockReload).toHaveBeenCalledWith("/LoadingResources");
  });

  it("offline at the due time: no reload onto the browser's error page — re-checks every 10 s until online", () => {
    crash(HEALTHY);
    online = false;

    advance(10_000);
    advance(10_000);
    advance(10_000);
    expect(mockReload).not.toHaveBeenCalled();

    online = true;
    advance(9_999);
    expect(mockReload).not.toHaveBeenCalled();
    advance(1);
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockReload).toHaveBeenCalledWith("/start");
  });

  it("START OVER reloads at once to the plan's target — online or not (a guest is there to see it)", () => {
    crash(HEALTHY);
    online = false;

    fireEvent.click(screen.getByTestId("app-error-start-over"));

    expect(mockReload).toHaveBeenCalledWith("/start");
  });

  it("START OVER after a young crash goes through the boot screen too", () => {
    crash(YOUNG);

    fireEvent.click(screen.getByTestId("app-error-start-over"));

    expect(mockReload).toHaveBeenCalledWith("/LoadingResources");
  });

  it("unmounting clears its one timer — it never reloads afterwards", () => {
    const view = crash(HEALTHY);
    // Its single 10 s timer (React may hold a 0 ms one of its own).
    const armed = vi.getTimerCount();

    view.unmount();
    expect(vi.getTimerCount()).toBe(armed - 1);

    advance(120_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(mockReload).not.toHaveBeenCalled();
  });

  it("reports the crash with the recovery it chose", () => {
    crash(YOUNG);

    expect(mockPlan).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        error_source: "react_boundary",
        error_message: "render crash in a child",
        component_stack_present: true,
        recovery_path: "/LoadingResources",
        recovery_in_ms: 60_000,
      })
    );
  });

  it("keeps no state outside itself (Rule 3): web storage is never touched", () => {
    const local = vi.spyOn(window.localStorage, "setItem");
    const session = vi.spyOn(window.sessionStorage, "setItem");

    crash(YOUNG);
    advance(60_000);

    expect(local).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });

  it("blocks the long-press context menu (App's kiosk hardening died with App)", () => {
    crash(HEALTHY);

    const notPrevented = fireEvent.contextMenu(screen.getByTestId("app-error"));

    expect(notPrevented).toBe(false);
  });
});

/*
  P9d — a LOCAL boundary (the splash media layer): with `fallback` it shows
  that known-good stand-in in place and reports, but plans no recovery, arms
  no timer and never shows the crash dialog — the rest of the screen works.
*/
describe("ErrorBoundary with a local fallback (P9d)", () => {
  const crashLocally = () =>
    render(
      <ErrorBoundary fallback={<p>static welcome</p>}>
        <Boom />
      </ErrorBoundary>
    );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockReload.mockReset();
    mockCapture.mockReset();
    mockPlan.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders healthy children untouched — the fallback only replaces a crash", () => {
    render(
      <ErrorBoundary fallback={<p>static welcome</p>}>
        <p>splash media</p>
      </ErrorBoundary>
    );

    expect(screen.getByText("splash media")).toBeInTheDocument();
    expect(screen.queryByText("static welcome")).not.toBeInTheDocument();
  });

  it("a crash renders the fallback in place — no crash dialog, no kiosk stage", () => {
    crashLocally();

    expect(screen.getByText("static welcome")).toBeInTheDocument();
    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kiosk-stage")).not.toBeInTheDocument();
  });

  it("reports the crash as recovered locally (recovery_path 'local_fallback', no reload planned)", () => {
    crashLocally();

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith("error_occurred", {
      error_source: "react_boundary",
      error_message: "render crash in a child",
      component_stack_present: true,
      recovery_path: "local_fallback",
    });
  });

  it("plans no recovery and arms no timer — nothing ever reloads", () => {
    crashLocally();
    advance(1); // React may hold a 0 ms timer of its own

    expect(mockPlan).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    advance(120_000);
    expect(mockReload).not.toHaveBeenCalled();
    expect(screen.getByText("static welcome")).toBeInTheDocument();
  });
});
