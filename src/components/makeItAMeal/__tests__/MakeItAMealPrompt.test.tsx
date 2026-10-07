import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  blackListedItems,
  closeMakeItAMealModal,
  closeMakeItAMealSession,
  makeItAMealIsOpen,
  makeItAMealIsSessionOpen,
  openComboConstutientCustomizations,
  openMakeItAMealModal,
  selectIsForceOpenMakeItAMealModal,
  setIsForceOpenMakeItAMealModal,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import { setSelectedEntity } from "../../../redux/features/menuSelections/menuSelections.slice";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import MakeItAMealPrompt from "../MakeItAMealPrompt";
import i18n from "../../../i18n";

/** Plain upsell combo (no modifiers/variants → checkCustomizationType "item"). */
const COMBO = {
  id: "combo-1",
  name: "Dream Box",
  price: 7.99,
  isActive: true,
  outOfStock: false,
  image_url: "",
};

/** Plain original item (no modifiers/variants → declined as a straight add). */
const BURGER = {
  id: "burger-1",
  name: "Cheese Burger",
  price: 3.5,
  description: "A cheesy classic",
  upsellItems: [COMBO],
};

const openPrompt = () =>
  store.dispatch(
    openMakeItAMealModal({
      isOpen: true,
      selectedItem: BURGER,
      availableCombos: [COMBO],
    })
  );

const renderPrompt = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <MakeItAMealPrompt />
      </MemoryRouter>
    </Provider>
  );

describe("MakeItAMealPrompt (P6c — MIAM upsell prompt)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("renders nothing while the prompt state is closed", () => {
    renderPrompt();
    expect(screen.queryByTestId("miam-prompt")).not.toBeInTheDocument();
  });

  it("renders headline, combo cards and both CTAs when opened", () => {
    openPrompt();
    renderPrompt();
    const prompt = screen.getByTestId("miam-prompt");
    // slice default headline (primaryMakeItAMealText)
    expect(prompt).toHaveTextContent(/would you like to make it a meal/i);
    // Figma 1:3070 has no description line — the subText/description
    // paragraph was dropped in the re-skin, deliberately.
    expect(prompt).not.toHaveTextContent("A cheesy classic");
    const combo = screen.getByTestId("miam-combo-combo-1");
    expect(combo).toHaveTextContent("Dream Box");
    expect(combo).toHaveTextContent("7.99");
    // Copy-only CTAs per the frame: accept above, "not today" below — the
    // original item's price is no longer appended to the decline label.
    expect(screen.getByTestId("miam-accept")).toHaveTextContent(
      /yes, make it a meal/i
    );
    expect(screen.getByTestId("miam-decline")).toHaveTextContent(/not today/i);
    expect(screen.getByTestId("miam-decline")).not.toHaveTextContent("3.50");
    expect(screen.getByTestId("miam-close")).toBeInTheDocument();
  });

  it("decline adds the ORIGINAL item to the cart, blacklists it and closes the prompt", async () => {
    openPrompt();
    renderPrompt();
    await userEvent.click(screen.getByTestId("miam-decline"));

    const state = store.getState();
    const cart = selectCart(state);
    expect(cart.cartItems).toHaveLength(1);
    expect(cart.cartItems[0]).toMatchObject({
      id: "burger-1",
      quantity: 1,
      total_price: 3.5,
    });
    expect(cart.subTotal).toBe(3.5);
    // declined → never re-prompt for this item
    expect(blackListedItems(state)["burger-1"]).toBe(true);
    // prompt + session torn down, force latch cleared
    expect(makeItAMealIsOpen(state)).toBe(false);
    expect(makeItAMealIsSessionOpen(state)).toBe(false);
    expect(selectIsForceOpenMakeItAMealModal(state)).toBe(false);
    expect(screen.queryByTestId("miam-prompt")).not.toBeInTheDocument();
  });

  it("accepting a plain combo adds the combo (not the original) and closes", async () => {
    openPrompt();
    renderPrompt();
    await userEvent.click(screen.getByTestId("miam-combo-combo-1"));

    const state = store.getState();
    const cart = selectCart(state);
    expect(cart.cartItems).toHaveLength(1);
    expect(cart.cartItems[0]).toMatchObject({
      id: "combo-1",
      quantity: 1,
      total_price: 7.99,
    });
    // the original item was NOT blacklisted on accept
    expect(blackListedItems(state)["burger-1"]).toBeUndefined();
    expect(makeItAMealIsOpen(state)).toBe(false);
    expect(screen.queryByTestId("miam-prompt")).not.toBeInTheDocument();
  });

  it("the X closes the prompt without adding anything to the cart", async () => {
    openPrompt();
    renderPrompt();
    await userEvent.click(screen.getByTestId("miam-close"));

    const state = store.getState();
    expect(selectCart(state).cartItems).toHaveLength(0);
    expect(blackListedItems(state)["burger-1"]).toBeUndefined();
    expect(makeItAMealIsOpen(state)).toBe(false);
    expect(selectIsForceOpenMakeItAMealModal(state)).toBe(false);
    expect(screen.queryByTestId("miam-prompt")).not.toBeInTheDocument();
  });

  it("ADA (P9c): the card is capped by its containing block; the X and both CTAs never scroll away", () => {
    openPrompt();
    renderPrompt();
    const close = screen.getByTestId("miam-close");

    expect(close.closest('[class*="max-h-[calc(100%_-_48px)]"]')).not.toBeNull();
    for (const id of ["miam-close", "miam-accept", "miam-decline"]) {
      expect(screen.getByTestId(id).closest(".overflow-y-auto")).toBeNull();
    }
    expect(
      screen.getByTestId("miam-combo-combo-1").closest(".overflow-y-auto")
    ).not.toBeNull();
  });
});

/*
  Item 30 (D3) — the variant-shaped decline, on SYNTHETIC variant fixtures
  (TB's catalog has no variant upsells yet). The fork's isVariantUpsell
  branch (OptionsUpSell "No thanks" → setSelectedVariantRdx) is unreachable:
  the flag is read, never written. Fork parity is therefore its reachable
  path, handleItemAddToCart(MIAMSelectedItem) (OptionsUpSell.tsx:85-138).
*/
describe("MakeItAMealPrompt — variant-shaped decline (item 30, fork parity)", () => {
  const renderRoutes = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/menu"]}>
          <Routes>
            <Route path="/menu" element={<MakeItAMealPrompt />} />
            <Route path="/customization" element={<p data-testid="pdp-route" />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const decline = (selectedItem: Record<string, unknown>) => {
    store.dispatch(
      openMakeItAMealModal({ isOpen: true, selectedItem, availableCombos: [COMBO] })
    );
    const dispatch = vi.spyOn(store, "dispatch");
    renderRoutes();
    dispatch.mockClear();
    return { dispatch, click: () => userEvent.click(screen.getByTestId("miam-decline")) };
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a sized original opens its size picker on the PDP — the fork's variant executor, action for action", async () => {
    const SODA = {
      id: "soda-1",
      name: "Soda",
      price: 2,
      hasVariant: true,
      isVariant: false,
      subCategoryId: "drinks",
      modifiers: [],
      variants: [
        { id: "soda-s", name: "Small", price: 2 },
        { id: "soda-l", name: "Large", price: 3 },
      ],
      upsellItems: [COMBO],
    };
    const { dispatch, click } = decline(SODA);
    await click();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setIsForceOpenMakeItAMealModal(false), // TB: the force latch never outlives the prompt
      closeMakeItAMealModal(),
      closeMakeItAMealSession({ force: false }),
      setSelectedEntity({ ...SODA }),
      openComboConstutientCustomizations(),
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, type: "variant", openType: "new" },
        selectedEntity: { ...SODA, quantity: 1, subCategoryId: "drinks", hasSecondTier: false },
      }),
    ]);
    expect(await screen.findByTestId("pdp-route")).toBeInTheDocument();
    const state = store.getState();
    expect(selectCart(state).cartItems).toHaveLength(0);
    expect(blackListedItems(state)["soda-1"]).toBeUndefined();
    expect(makeItAMealIsOpen(state)).toBe(false);
  });

  it("a variantItem pseudo-entity original (one size, with its addons) goes to the PDP as a customizable item — never the size picker, never an add", async () => {
    // catalog collectLegacyEntityMaps: {...variant, entityType:"variantItem", hasVariant:false, isVariant:false}
    const LARGE_SODA = {
      id: "soda-l",
      name: "Large",
      price: 3,
      entityType: "variantItem",
      hasVariant: false,
      isVariant: false,
      isAvailable: true,
      applyAddonsPrice: false,
      modifiers: ["soda-l_1_addons"],
      upsellItems: [COMBO],
    };
    const { dispatch, click } = decline(LARGE_SODA);
    await click();

    const types = dispatch.mock.calls.map(([action]) => (action as { type: string }).type);
    expect(types.slice(0, 2)).toEqual([
      setIsForceOpenMakeItAMealModal.type,
      closeMakeItAMealModal.type,
    ]);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: setTier1BottomSheetAndSelectedEntity.type,
        payload: expect.objectContaining({
          bottomSheet: expect.objectContaining({ type: "variant" }),
        }),
      })
    );
    expect(await screen.findByTestId("pdp-route")).toBeInTheDocument();
    const state = store.getState();
    expect(selectCart(state).cartItems).toHaveLength(0);
    expect(blackListedItems(state)["soda-l"]).toBeUndefined();
    expect(selectIsForceOpenMakeItAMealModal(state)).toBe(false);
  });

  /* test-author addition (lane bag-pdp, item 30 case b) */
  it("an isVariant-shaped original (a size, no groups of its own) is a plain add: ONE item row at the size's price, blacklisted, prompt and session closed", async () => {
    const LARGE_SODA = {
      id: "soda-l",
      name: "Large Soda",
      price: 3,
      isVariant: true,
      hasVariant: false,
      subCategoryId: "drinks",
      upsellItems: [COMBO],
    };
    const { click } = decline(LARGE_SODA);
    await click();

    const state = store.getState();
    const cart = selectCart(state);
    expect(cart.cartItems).toHaveLength(1);
    expect(cart.cartItems[0]).toMatchObject({ id: "soda-l", quantity: 1, total_price: 3, price: 3 });
    expect(cart.cartItems[0].type).not.toBe("VARIANT");
    expect(cart.subTotal).toBe(3);
    expect(blackListedItems(state)["soda-l"]).toBe(true);
    expect(makeItAMealIsOpen(state)).toBe(false);
    expect(makeItAMealIsSessionOpen(state)).toBe(false);
    expect(selectIsForceOpenMakeItAMealModal(state)).toBe(false);
    expect(screen.queryByTestId("pdp-route")).not.toBeInTheDocument(); // no detour
  });
});

/*
  Post-P9 29c (D8): the operator's make_it_meal_<slot> text replaces the Figma
  headline, read from the GUEST's slot only (no cross-language fallback); a
  staged "" (the boot's unset value) shows the translated miam.title. 28: the
  combo name is the menu's ar alias, isolated, in an Arabic session.
*/
describe("MakeItAMealPrompt — headline per language slot (post-P9 29c)", () => {
  const FSI = "\u2068";
  const PDI = "\u2069";
  const iso = (s: string) => `${FSI}${s}${PDI}`;
  const AR_OPERATOR = "هل تريدها وجبة؟";
  const AR_COMBO = "صندوق الأحلام";
  const AR_SESSION = { name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" };

  /** What the boot stages from kiosk_settings.make_it_meal_<slot>. */
  const stageTexts = (primary: string, secondary: string) => {
    store.dispatch({ type: "makeItAMeal/setPrimaryMakeItAMealText", payload: primary });
    store.dispatch({ type: "makeItAMeal/setSecondaryMakeItAMealText", payload: secondary });
  };
  const arabicSession = async () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
  };
  const headline = () => screen.getByRole("heading").textContent;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("'' (no operator text) shows the English miam.title", () => {
    stageTexts("", "");
    openPrompt();
    renderPrompt();

    expect(headline()).toBe(i18n.t("miam.title"));
    expect(headline()).toBe("Would you like to make it a meal?");
  });

  it("'' in an Arabic session shows the Arabic miam.title", async () => {
    stageTexts("", "");
    await arabicSession();
    openPrompt();
    renderPrompt();

    expect(headline()).toBe(i18n.t("miam.title"));
    expect(headline()).toContain(FSI);
    expect(headline()).not.toContain("meal");
  });

  it("an operator primary text shows in English, trimmed and unisolated", () => {
    stageTexts("  Meal deal? ", "");
    openPrompt();
    renderPrompt();

    expect(headline()).toBe("Meal deal?");
  });

  it("an operator secondary text shows in Arabic, isolated — never the primary one", async () => {
    stageTexts("Meal deal?", AR_OPERATOR);
    await arabicSession();
    openPrompt();
    renderPrompt();

    expect(headline()).toBe(iso(AR_OPERATOR));
    expect(screen.getByTestId("miam-prompt")).not.toHaveTextContent("Meal deal?");
  });

  it("Arabic with only a primary text shows the Arabic i18n copy (no cross-language fallback)", async () => {
    stageTexts("Meal deal?", "");
    await arabicSession();
    openPrompt();
    renderPrompt();

    expect(headline()).toBe(i18n.t("miam.title"));
    expect(screen.getByTestId("miam-prompt")).not.toHaveTextContent("Meal deal?");
  });

  it("a non-string slot (persisted junk) falls back to miam.title", () => {
    store.dispatch({ type: "makeItAMeal/setPrimaryMakeItAMealText", payload: 42 });
    openPrompt();
    renderPrompt();

    expect(headline()).toBe(i18n.t("miam.title"));
  });

  it("28: the combo card shows its ar alias, isolated, in an Arabic session — and its English name again after", async () => {
    const arCombo = { ...COMBO, aliases: [{ value: AR_COMBO, name: "Arabic", code: "ar" }] };
    await arabicSession();
    store.dispatch(
      openMakeItAMealModal({ isOpen: true, selectedItem: { ...BURGER, upsellItems: [arCombo] }, availableCombos: [arCombo] })
    );
    renderPrompt();

    const combo = screen.getByTestId("miam-combo-combo-1");
    expect(combo).toHaveTextContent(iso(AR_COMBO), { normalizeWhitespace: false });
    expect(combo).not.toHaveTextContent("Dream Box");

    act(() => {
      store.dispatch(setSelectedLanguage({ name: "English", code: "en", dir: "ltr", type: "primary_language" }));
    });
    expect(combo).toHaveTextContent("Dream Box");
    expect(combo.textContent).not.toMatch(/[\u2066-\u2069]/);
  });
});
