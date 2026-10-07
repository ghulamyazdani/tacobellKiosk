/**
 * OfferTierHost — the embedded PDP host inside the bag (lane "offers", item
 * 32). It shows ONLY an offer tier session (isGetItem freebie / isBuyStageItem
 * buy item), never mirrors a normal /customization session, and on unmount
 * closes ONLY an offer session it would otherwise orphan. StrictMode-safe
 * because it mounts with the bag, before any such session exists.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  makeItAMealIsSessionOpen,
  openComboConstutientCustomizations,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import OfferTierHost from "../OfferTierHost";
import "../../../i18n";

const PICKLE_GROUP = {
  _id: "pickle_group",
  name: "Extras",
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "pickles", name: "Extra Pickles", price: 1, isActive: true }],
};

const BURGER = {
  id: "cheese-burger",
  name: "Cheese Burger",
  price: 9,
  modifiers: ["pickle_group"],
  hasVariant: false,
  quantity: 1,
  hasSecondTier: false,
};

/** A tier-1 session as the openers seed it (normal = edit-from-bag / menu). */
const openSession = (selectedEntity: object) => {
  store.dispatch(openComboConstutientCustomizations());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new" },
      selectedEntity,
    })
  );
};

const renderHost = (reactStrictMode = false) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <OfferTierHost />
      </MemoryRouter>
    </Provider>,
    { reactStrictMode }
  );

const sessionOpen = () => Boolean(makeItAMealIsSessionOpen(store.getState()));
const CLOSE = "makeItAMeal/closeMakeItAMealSession";
const closeDispatches = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([action]) => (action as { type?: string })?.type === CLOSE).length;

describe("OfferTierHost", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: { pickle_group: PICKLE_GROUP } }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing without a session, and NEVER mirrors a normal (unmarked) session", () => {
    renderHost();
    expect(screen.queryByTestId("offer-tier-host")).not.toBeInTheDocument();
    act(() => openSession(BURGER));
    expect(sessionOpen()).toBe(true);
    expect(screen.queryByTestId("offer-tier-host")).not.toBeInTheDocument();
    expect(screen.queryByTestId("customization-screen")).not.toBeInTheDocument();
  });

  it.each([
    ["an isGetItem freebie", { ...BURGER, isGetItem: true, type: "CUSTOMIZABLE" }],
    ["an isBuyStageItem buy item", { ...BURGER, isBuyStageItem: true }],
  ])("hosts the embedded PDP full-bleed at z-[85] for %s", (_label, entity) => {
    renderHost();
    act(() => openSession(entity));
    const host = screen.getByTestId("offer-tier-host");
    expect(host.className).toContain("absolute inset-0 z-[85]");
    expect(within(host).getByTestId("customization-screen")).toHaveAttribute("data-embedded", "true");
  });

  it("unmount with an offer session open closes it (the bag going away mid-tier)", () => {
    const spy = vi.spyOn(store, "dispatch");
    const view = renderHost();
    act(() => openSession({ ...BURGER, isGetItem: true }));
    spy.mockClear();

    view.unmount();

    expect(closeDispatches(spy)).toBe(1);
    expect(sessionOpen()).toBe(false);
    spy.mockRestore();
  });

  it("unmount with a NORMAL session open leaves it alone (an edit-from-bag heading to /customization survives)", () => {
    const spy = vi.spyOn(store, "dispatch");
    const view = renderHost();
    act(() => openSession(BURGER));
    spy.mockClear();

    view.unmount();

    expect(spy).not.toHaveBeenCalled();
    expect(sessionOpen()).toBe(true);
    spy.mockRestore();
  });

  it("unmount with no session dispatches nothing", () => {
    const spy = vi.spyOn(store, "dispatch");
    const view = renderHost();
    view.unmount();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("under StrictMode, mounting BEFORE a session never closes the later session", () => {
    const spy = vi.spyOn(store, "dispatch");
    const view = renderHost(true);
    act(() => openSession({ ...BURGER, isGetItem: true }));

    expect(screen.getByTestId("offer-tier-host")).toBeInTheDocument();
    expect(sessionOpen()).toBe(true);
    expect(closeDispatches(spy)).toBe(0);

    view.unmount();
    expect(closeDispatches(spy)).toBe(1);
    expect(sessionOpen()).toBe(false);
    spy.mockRestore();
  });
});
