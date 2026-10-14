import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  closeAccessibilityMode,
  setEnableAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import gbFlag from "../../../assets/flags/gb.svg";
import FooterBar from "../FooterBar";
import i18n from "../../../i18n";
import { KioskEventName } from "@cx-sdk/core";

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

/*
  P9c (A5): the ADA DISPLAY toggle. Shown only while the tenant has the
  feature on (fork parity); `aria-pressed` carries the on-state Figma does not
  draw. Its label, icon and 56px target are the Figma "Footer bottom" chrome
  and must not change.
*/

const renderFooter = () =>
  render(
    <Provider store={store}>
      <FooterBar onCancelOrder={vi.fn()} onOpenLanguage={vi.fn()} />
    </Provider>
  );

const adaButton = () => screen.queryByTestId("footer-ada");
const tapAda = () => {
  const button = adaButton();
  if (!button) throw new Error("ADA button is not rendered");
  fireEvent.click(button);
};
const adaMode = () =>
  Boolean(
    (store.getState() as { appSettings: { accessibilityMode: unknown } })
      .appSettings.accessibilityMode
  );

describe("FooterBar — ADA DISPLAY (P9c)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("toggles the guest's flag, and aria-pressed follows the flag wherever it changes", () => {
    renderFooter();
    expect(adaButton()).toHaveAttribute("aria-pressed", "false");

    tapAda();
    expect(adaMode()).toBe(true);
    expect(adaButton()).toHaveAttribute("aria-pressed", "true");

    // The brand-zone exit closes it from elsewhere.
    act(() => {
      store.dispatch(closeAccessibilityMode());
    });
    expect(adaButton()).toHaveAttribute("aria-pressed", "false");

    tapAda();
    tapAda();
    expect(adaMode()).toBe(false);
  });

  it("is hidden while the tenant has the feature off; the rest of the strip stays", () => {
    store.dispatch(setEnableAccessibilityMode(false));
    renderFooter();

    expect(adaButton()).not.toBeInTheDocument();
    expect(screen.getByTestId("footer-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("footer-language")).toBeInTheDocument();

    act(() => {
      store.dispatch(setEnableAccessibilityMode(true));
    });
    expect(adaButton()).toBeInTheDocument();
  });

  it("keeps the Figma chrome: label, icon and a 56px target", () => {
    renderFooter();

    expect(adaButton()).toHaveTextContent(i18n.t("footer.adaDisplay"));
    // Figma's glyph, inline so it takes the label's colour (fill-current).
    const glyph = adaButton()?.querySelector("svg");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveClass("h-[32px]", "w-[32px]", "fill-current");
    expect(adaButton()?.className).toContain("h-[56px]");
    expect(adaButton()?.className).toContain("min-w-[44px]");
  });

  // Walk 2026-10-14: aria-pressed flipped but the button looked the same.
  // On = the bag order-type pill's white fill, label and glyph in tb-purple;
  // off = Figma's bare white label on the bar.
  it("shows its on-state: a white fill with a purple label and glyph, gone again when off", () => {
    renderFooter();
    const label = () => adaButton()?.querySelector("span");
    expect(adaButton()).toHaveClass("text-tb-surface");
    expect(adaButton()).not.toHaveClass("bg-tb-surface");

    tapAda();
    expect(adaButton()).toHaveAttribute("aria-pressed", "true");
    expect(adaButton()).toHaveClass("bg-tb-surface", "text-tb-purple");
    expect(adaButton()).not.toHaveClass("text-tb-surface");
    // The label and the glyph inherit the button's colour.
    expect(label()?.className).not.toMatch(/\btext-tb-/);

    tapAda();
    expect(adaButton()).toHaveAttribute("aria-pressed", "false");
    expect(adaButton()).toHaveClass("text-tb-surface");
    expect(adaButton()).not.toHaveClass("bg-tb-surface");
  });
});

/*
  audit-fixes B3 — CANCEL ORDER sends StartOverClickedFromFooter with the
  route it was tapped on (/second, /menu, /customization, /phone,
  /customerName share this bar), THEN opens the caller's confirm.
*/
describe("FooterBar — CANCEL ORDER analytics (audit-fixes B3)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mockCapture.mockReset();
    window.history.replaceState(null, "", "/customization");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("reports the tap with its route, then calls onCancelOrder", () => {
    const order: string[] = [];
    mockCapture.mockImplementation((event: string) => order.push(event));
    const onCancelOrder = vi.fn(() => order.push("onCancelOrder"));
    render(
      <Provider store={store}>
        <FooterBar onCancelOrder={onCancelOrder} onOpenLanguage={vi.fn()} />
      </Provider>
    );

    fireEvent.click(screen.getByTestId("footer-cancel"));

    expect(mockCapture).toHaveBeenCalledWith(KioskEventName.StartOverClickedFromFooter, {
      route_path: "/customization",
    });
    expect(order).toEqual([KioskEventName.StartOverClickedFromFooter, "onCancelOrder"]);
  });

  it("the language and ADA buttons report no start-over", () => {
    renderFooter();

    fireEvent.click(screen.getByTestId("footer-language"));
    tapAda();

    expect(
      mockCapture.mock.calls.filter(([event]) => event === KioskEventName.StartOverClickedFromFooter)
    ).toEqual([]);
  });
});

/*
  Walk 2026-10-14: the language button always showed the GB flag — beside
  العربية too (it was hardcoded). It shows the flag of the language in use
  where one is known (English: Figma's Great Britain), and none otherwise.
*/
describe("FooterBar — the language button's flag", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  const languageButton = () => screen.getByTestId("footer-language");
  /** The round flag chip (the chevron is the button's other image). */
  const flag = () => languageButton().querySelector("span.rounded-full img");

  it("English — chosen, or the default before any choice: the Great Britain flag", () => {
    renderFooter();
    expect(flag()).toHaveAttribute("src", gbFlag);

    act(() => {
      store.dispatch(setSelectedLanguage({ name: "English", code: "en", dir: "ltr" }));
    });
    expect(flag()).toHaveAttribute("src", gbFlag);
  });

  it("Arabic: no flag — none is known for it — beside its own name; back to English, the flag returns", () => {
    renderFooter();
    act(() => {
      store.dispatch(setSelectedLanguage({ name: "العربية", code: "ar", dir: "rtl" }));
    });

    expect(flag()).toBeNull();
    expect(languageButton().querySelectorAll("img")).toHaveLength(1); // the chevron only
    expect(languageButton()).toHaveTextContent("العربية");

    act(() => {
      store.dispatch(setSelectedLanguage({ name: "English", code: "en", dir: "ltr" }));
    });
    expect(flag()).toHaveAttribute("src", gbFlag);
  });
});
