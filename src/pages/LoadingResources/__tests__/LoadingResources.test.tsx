import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { store } from "../../../redux/app/store";
import type { BootFailure } from "../../../hooks/utils/useLoaders";
import LoadingResources from "../index";
import i18n from "../../../i18n";

/*
  P9b R7 — the boot screen recovers by itself. The loader is the seam: each
  LoadResourcesInitially call is recorded and the test settles it by hand
  (success / a categorised failure). useNavigate is a spy; the clock is fake.

  The countdown is a chain of 1 s timeouts, each armed by the previous tick's
  render, so time is stepped one second per act() — one tick per step, exactly
  as on the device.
*/

interface BootCall {
  fail: (failure: BootFailure) => void;
  succeed: () => void;
}

const { boots, mockNavigate, logoutKiosk } = vi.hoisted(() => ({
  boots: [] as BootCall[],
  mockNavigate: vi.fn(),
  logoutKiosk: vi.fn(),
}));

vi.mock("../../../hooks/utils/useLoaders", () => ({
  default: () => ({
    LoadResourcesInitially: (
      fail: (failure: BootFailure) => void,
      succeed: () => void
    ) => {
      boots.push({ fail, succeed });
      return Promise.resolve();
    },
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

// ActivityModal's logout (ActivityCenter.test precedent).
vi.mock("../../../hooks/utils/useAuthHook", () => ({
  default: () => ({ logoutKiosk }),
}));

const mount = (options: { reactStrictMode?: boolean } = {}) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/LoadingResources"]}>
        <LoadingResources />
      </MemoryRouter>
    </Provider>,
    options
  );

/** Settle the most recent boot. */
const failLatest = (failure: BootFailure) =>
  act(() => {
    boots[boots.length - 1].fail(failure);
  });

/** Step the fake clock one second per render, as the countdown runs. */
const tick = async (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
};

const dialog = () => screen.queryByTestId("loading-error");
const note = () => screen.getByTestId("loading-error-note").textContent;

describe("LoadingResources — boot recovery (P9b R7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    boots.length = 0;
    mockNavigate.mockReset();
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("boots ONCE on mount (StrictMode re-runs mount effects) and goes to /start on success", () => {
    mount({ reactStrictMode: true });
    expect(boots).toHaveLength(1);
    expect(screen.getByText(i18n.t("loading.preparing"))).toBeInTheDocument();

    act(() => boots[0].succeed());

    expect(mockNavigate).toHaveBeenCalledWith("/start");
    expect(dialog()).not.toBeInTheDocument();
  });

  it("an unreachable backend: 'Can't connect', a countdown and TRY AGAIN NOW — and NO 'Back to registration'", async () => {
    mount();
    await failLatest("unavailable");

    const error = screen.getByTestId("loading-error");
    expect(error).toHaveAttribute("role", "alertdialog");
    expect(error).toHaveAccessibleName(i18n.t("loading.unavailableTitle"));
    expect(error).toHaveAccessibleDescription(i18n.t("loading.unavailableBody"));
    expect(note()).toBe(i18n.t("loading.retryIn", { seconds: 10 }));
    expect(note()).toBe("Trying again in 10s");
    expect(screen.queryByText(i18n.t("loading.preparing"))).not.toBeInTheDocument();

    // The one way out is forward: the old button opened an un-booted splash.
    const buttons = within(error).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("data-testid", "loading-error-retry");
    expect(buttons[0]).toHaveTextContent(i18n.t("loading.retryNow"));
    expect(screen.queryByText(/registration/i)).not.toBeInTheDocument();
    expect(i18n.exists("loading.backToRegistration")).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it.each([
    ["noLanguage", "loading.configNoLanguage"],
    ["noPipelines", "loading.configNoPipelines"],
    ["noStartText", "loading.configNoStartText"],
  ] as const)("a configuration failure (%s) names its fix under 'Configuration error'", async (failure, body) => {
    mount();
    await failLatest(failure);

    const error = screen.getByTestId("loading-error");
    expect(error).toHaveAccessibleName(i18n.t("loading.errorTitle"));
    expect(error).toHaveAccessibleDescription(i18n.t(body));
    // Config failures retry too: a Cockpit fix is picked up untouched.
    expect(note()).toBe(i18n.t("loading.retryIn", { seconds: 10 }));
  });

  it("counts down once a second and boots again at exactly 10 s", async () => {
    mount();
    await failLatest("unavailable");

    await tick(1);
    expect(note()).toBe(i18n.t("loading.retryIn", { seconds: 9 }));

    await tick(8);
    expect(note()).toBe(i18n.t("loading.retryIn", { seconds: 1 }));
    expect(boots).toHaveLength(1);

    await tick(1);
    expect(boots).toHaveLength(2);
    // Back to "Preparing your kiosk…" while it runs.
    expect(dialog()).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t("loading.preparing"))).toBeInTheDocument();
  });

  it("backs off 10 s → 30 s → 60 s, then every 60 s — never gives up", async () => {
    mount();
    for (const [attempt, delay] of [
      [1, 10],
      [2, 30],
      [3, 60],
      [4, 60],
      [5, 60],
    ]) {
      await failLatest("unavailable");
      expect(note()).toBe(i18n.t("loading.retryIn", { seconds: delay }));

      await tick(delay - 1);
      expect(boots).toHaveLength(attempt);
      await tick(1);
      expect(boots).toHaveLength(attempt + 1);
    }
  });

  it("TRY AGAIN NOW boots at once and cancels the countdown (no second boot behind it)", async () => {
    mount();
    await failLatest("unavailable");
    await tick(3);

    fireEvent.click(screen.getByTestId("loading-error-retry"));
    expect(boots).toHaveLength(2);
    expect(dialog()).not.toBeInTheDocument();

    // The old countdown is gone: nothing else starts while this boot runs.
    await tick(120);
    expect(boots).toHaveLength(2);

    // A manual retry still advances the cadence.
    await failLatest("unavailable");
    expect(note()).toBe(i18n.t("loading.retryIn", { seconds: 30 }));
  });

  it("the network coming back retries at once instead of waiting out the countdown", async () => {
    mount();
    await failLatest("unavailable");

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await tick(2);
    expect(boots).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(boots).toHaveLength(2);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("a reconnect while a boot is already running starts no second one", async () => {
    mount();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await tick(1);

    expect(boots).toHaveLength(1);
  });

  it("unmounting stops everything: no further boots and no timer left behind", async () => {
    const view = mount();
    await failLatest("unavailable");

    view.unmount();
    await tick(120);

    expect(boots).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmounting on the countdown's last second cancels the boot it was about to start", async () => {
    const view = mount();
    await failLatest("unavailable");
    await tick(9);

    view.unmount();
    await tick(5);

    expect(boots).toHaveLength(1);
  });

  it("a boot that settles after unmount neither navigates nor raises the dialog", () => {
    const view = mount();
    const [first] = boots;
    view.unmount();

    act(() => first.succeed());
    act(() => first.fail("unavailable"));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(dialog()).not.toBeInTheDocument();
  });

  it("operators: a 3 s hold on the top-left corner opens the Activity Center over the dialog", async () => {
    mount();
    await failLatest("unavailable");

    const hotspot = screen.getByTestId("loading-activity-hotspot");
    fireEvent.mouseDown(hotspot);
    act(() => {
      vi.advanceTimersByTime(2_900);
    });
    expect(screen.queryByTestId("activity-modal")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.mouseUp(hotspot);

    expect(screen.getByTestId("activity-modal")).toBeInTheDocument();
    // The dialog (z-80) would cover it; the hotspot would eat its backdrop taps.
    expect(dialog()).not.toBeInTheDocument();
    expect(screen.queryByTestId("loading-activity-hotspot")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("activity-close"));
    expect(screen.queryByTestId("activity-modal")).not.toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByTestId("loading-activity-hotspot")).toBeInTheDocument();
  });

  it("a short tap on the hotspot does nothing", async () => {
    mount();
    await failLatest("unavailable");

    const hotspot = screen.getByTestId("loading-activity-hotspot");
    fireEvent.mouseDown(hotspot);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.mouseUp(hotspot);

    expect(screen.queryByTestId("activity-modal")).not.toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
  });

  it("speaks the kiosk's language (AR)", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    mount();
    await failLatest("unavailable");

    const error = screen.getByTestId("loading-error");
    expect(error).toHaveAccessibleName("تعذر الاتصال");
    expect(note()).toBe("إعادة المحاولة خلال 10 ث");
    expect(screen.getByTestId("loading-error-retry")).toHaveTextContent(
      "حاول مرة أخرى الآن"
    );
  });
});
