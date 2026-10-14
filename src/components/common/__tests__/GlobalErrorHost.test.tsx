import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  selectErrorMessageGlobal,
  selectShowErrorModalGlobal,
  setCurrency,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { KioskEventName } from "../../../utils/analytics";
import GlobalErrorHost from "../GlobalErrorHost";
import i18n from "../../../i18n";

/*
  Lane figma-polish G1 — the ONE renderer of the global error flag
  (setShowErrorModalGlobal: PAY failures, the DP session cap, customization
  limits, the loyalty entry guards — silent before this host). The 1:6288
  Icon Modal layout: the message IS the title, no body, one wide GOT IT that
  clears the flag; z-[95]; never auto-dismissed (WCAG 2.2.1). One
  ErrorOccurred {global_banner} per open and per new message (fork ErrorCard).
  Seam: captureKioskEvent only.
*/

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: mocks.capture,
}));

const raise = (errorMessage: string) =>
  act(() => {
    store.dispatch(setShowErrorModalGlobal({ showErrorModal: true, errorMessage }));
  });

const renderHost = () =>
  render(
    <Provider store={store}>
      <GlobalErrorHost />
    </Provider>
  );

const dialog = () => screen.queryByRole("alertdialog");
const bannerEvents = () =>
  mocks.capture.mock.calls.filter(
    ([event, props]) =>
      event === KioskEventName.ErrorOccurred &&
      (props as { error_source?: string } | undefined)?.error_source === "global_banner"
  );

describe("GlobalErrorHost (G1 — Figma Icon Modal 1:6288 for the global error flag)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mocks.capture.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flag off: renders nothing and reports nothing", () => {
    const { container } = renderHost();

    expect(container).toBeEmptyDOMElement();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("flag on: an alertdialog named by the message (its title), the warning icon, no body and no aria-describedby", () => {
    renderHost();
    raise("Please choose a size first");

    const modal = dialog();
    expect(modal).toHaveAttribute("data-testid", "global-error");
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(modal).toHaveAccessibleName("Please choose a size first");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Please choose a size first");
    expect(modal).not.toHaveAttribute("aria-describedby");
    expect(modal?.querySelector("p")).toBeNull();
    // The Icon L warning mark (1:990), decorative.
    const icon = modal?.querySelector("img");
    expect(icon).toHaveAttribute("alt", "");
    expect(decodeURIComponent(icon?.getAttribute("src") ?? "")).toContain("id='Icon L'");
  });

  it("ONE wide GOT IT (global-error-ok) that clears showGlobalError AND errorMessageGlobal", () => {
    renderHost();
    raise("Please complete every required choice");

    const ok = screen.getByTestId("global-error-ok");
    expect(screen.getAllByRole("button")).toEqual([ok]);
    expect(ok).toHaveTextContent(i18n.t("offers.gotIt"));
    expect(ok).toHaveClass("min-h-[60px]", "w-full");
    expect(ok).toHaveFocus();

    fireEvent.click(ok);

    expect(selectShowErrorModalGlobal(store.getState())).toBe(false);
    expect(selectErrorMessageGlobal(store.getState())).toBe("");
    expect(dialog()).not.toBeInTheDocument();
  });

  it("an empty message falls back to t('bag.checkoutFailed')", () => {
    renderHost();
    raise("");

    expect(dialog()).toHaveAccessibleName(i18n.t("bag.checkoutFailed"));
  });

  it("sits in a z-[95] full-stage wrapper: above every page overlay (≤ 80), below the idle prompt (100)", () => {
    renderHost();
    raise("Boom");

    expect(dialog()?.parentElement).toHaveClass("absolute", "inset-0", "z-[95]");
  });

  it("ErrorOccurred {global_banner, message}: once per open and once per NEW message — never on a re-render", () => {
    renderHost();
    raise("First");
    expect(bannerEvents()).toEqual([
      [KioskEventName.ErrorOccurred, { error_source: "global_banner", error_message: "First" }],
    ]);

    // Unrelated store churn re-renders nothing that matters…
    act(() => {
      store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    });
    // …and the same message raised again is the same open.
    raise("First");
    expect(bannerEvents()).toHaveLength(1);

    raise("Second");
    expect(bannerEvents()).toHaveLength(2);
    expect(bannerEvents()[1][1]).toEqual({ error_source: "global_banner", error_message: "Second" });

    fireEvent.click(screen.getByTestId("global-error-ok"));
    expect(bannerEvents()).toHaveLength(2);
    raise("Second"); // a fresh open of the same copy is a new open
    expect(bannerEvents()).toHaveLength(3);
  });

  it("never auto-dismisses: still open after 60 s of fake time (GOT IT is the only exit)", () => {
    vi.useFakeTimers();
    renderHost();
    raise("You can add up to 2 items during the Lunch session");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(dialog()).toBeInTheDocument();
    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
  });
});
