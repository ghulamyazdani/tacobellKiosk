import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import useCartUpsell from "../useCartUpsell";

/*
  The gate that decides whether the cart-upsell surfaces exist at all — the
  bag's Complete-Your-Meal rail AND the /forYou screen both hang off
  `shouldShowUpsell`.

  It is OPT-OUT, and that is the whole point of this suite.
  `enable_cart_upsell_screen` is not a field the settings API sends today, so a
  `=== true` check would keep both surfaces dark on every live kiosk while
  looking perfectly correct in review. `!== false` means the flagged items
  alone are enough — and a tenant can still switch the feature off by config
  once the flag is plumbed, which is the escape hatch that makes shipping an
  unsigned-off screen reversible.
*/

/** Converted-menu entityMap — only `isCartRecommended: true` entities count. */
const ENTITY_MAP = {
  fries: {
    id: "fries",
    name: "Large Fries",
    price: 2.5,
    isActive: true,
    isCartRecommended: true,
  },
  pepsi: {
    id: "pepsi",
    name: "Pepsi",
    price: 3,
    isActive: true,
    isCartRecommended: true,
  },
  // Flagged but inactive → the engine drops it (and counts it).
  churros: {
    id: "churros",
    name: "Churros",
    price: 5,
    isActive: false,
    isCartRecommended: true,
  },
  // Not flagged → never offered.
  burger: { id: "burger", name: "Cheese Burger", price: 8, isActive: true },
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(Provider, { store, children });

const loadMenu = (entityMap: Record<string, unknown> = ENTITY_MAP) => {
  store.dispatch(setEntityMap({ entityMap }));
};

/** `settings` is whatever the settings API put on `kiosk_settings`. */
const loadSettings = (settings: Record<string, unknown>) => {
  store.dispatch(setKioskSettings(settings));
};

const upsell = () => renderHook(() => useCartUpsell(), { wrapper }).result;

describe("useCartUpsell — the opt-OUT gate", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("is ON when the setting is absent — the live-kiosk case", () => {
    // RESET_STATE leaves kiosk_settings as {}, which is exactly what a kiosk
    // whose settings payload has never carried this flag looks like.
    loadMenu();
    const { current } = upsell();

    expect(current.shouldShowUpsell).toBe(true);
    expect(current.items.map((entity) => entity.id)).toEqual([
      "fries",
      "pepsi",
    ]);
  });

  it("is ON when the flag is explicitly true", () => {
    loadMenu();
    loadSettings({ enable_cart_upsell_screen: true });

    expect(upsell().current.shouldShowUpsell).toBe(true);
  });

  it("is OFF when the flag is the boolean false", () => {
    loadMenu();
    loadSettings({ enable_cart_upsell_screen: false });

    const { current } = upsell();
    expect(current.shouldShowUpsell).toBe(false);
    // The ITEMS are unchanged — only the gate closed. /forYou's mount guard
    // and Menu's forward edge both read the gate, not the list.
    expect(current.items).toHaveLength(2);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ['the string "false"', "false"],
    ["0", 0],
  ])(
    "stays ON for %s — only a real boolean false turns it off",
    (_l, value) => {
      loadMenu();
      loadSettings({ enable_cart_upsell_screen: value });

      expect(upsell().current.shouldShowUpsell).toBe(true);
    },
  );

  it("is OFF with no menu at all, however the flag reads", () => {
    // The menu slice is not persisted, so entityMap is null until fetchMenu
    // completes — the gate must be closed for that whole window.
    loadSettings({ enable_cart_upsell_screen: true });

    const { current } = upsell();
    expect(current.shouldShowUpsell).toBe(false);
    expect(current.items).toEqual([]);
  });

  it("is OFF when nothing is flagged — a gate that can render an empty surface is a broken gate", () => {
    loadMenu({ burger: ENTITY_MAP.burger });
    loadSettings({ enable_cart_upsell_screen: true });

    expect(upsell().current.shouldShowUpsell).toBe(false);
  });

  it("opens on a SINGLE flagged item — a tenant who flags one expects to see it", () => {
    loadMenu({ fries: ENTITY_MAP.fries });

    const { current } = upsell();
    expect(current.shouldShowUpsell).toBe(true);
    expect(current.items).toHaveLength(1);
  });

  it("reports why flagged items did not make it, for the suppression event", () => {
    // Menu's closed branch sends this straight to analytics, so the shape has
    // to be a flat numeric bag.
    loadMenu();
    const breakdown = upsell().current.getBreakdown();

    expect(breakdown.flagged).toBe(3);
    expect(breakdown.excluded_inactive).toBe(1);
    expect(breakdown.eligible).toBe(2);
    expect(breakdown.above_fold).toBe(2);
    expect(breakdown.hidden_over_capacity).toBe(0);
    Object.values(breakdown).forEach((value) =>
      expect(typeof value).toBe("number"),
    );
  });
});
