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
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import {
  selectAddToCartItem,
  selectAddToCartModal,
  setOutOfStockItems,
  setSelectedEntity,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import MakeItAMealPrompt from "../MakeItAMealPrompt";
import i18n from "../../../i18n";
import { KioskEventName } from "../../../utils/analytics";

// audit-fixes B3: analytics asserted per event (the real adapter is a no-op
// outside production builds anyway).
const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

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

  it("motion §3.2: with several combos the picked card bumps (tb-select on aria-pressed) and the pick follows the tap", async () => {
    const BOX = { ...COMBO, id: "combo-2", name: "Cravings Box" };
    store.dispatch(
      openMakeItAMealModal({
        isOpen: true,
        selectedItem: { ...BURGER, upsellItems: [COMBO, BOX] },
        availableCombos: [COMBO, BOX],
      })
    );
    renderPrompt();
    const [first, second] = ["combo-1", "combo-2"].map((id) => screen.getByTestId(`miam-combo-${id}`));
    for (const card of [first, second]) expect(card).toHaveClass("tb-select");
    expect(first).toHaveAttribute("aria-pressed", "true"); // the first is preselected
    expect(second).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
  });

  it("the combo's price carries the deployment's symbol (UB1 — never a bare amount)", () => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    openPrompt();
    renderPrompt();
    expect(screen.getByTestId("miam-combo-combo-1")).toHaveTextContent("£7.99");
  });

  // User decision 2026-10-14: posistKiosk's OptionsUpSell prints the meal's
  // price with moduloCalcaledValue — a whole price whole (walk: "﷼100.00").
  it("a whole combo price prints whole: £100, never £100.00", () => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    const MEAL = { ...COMBO, price: 100 };
    store.dispatch(
      openMakeItAMealModal({ isOpen: true, selectedItem: { ...BURGER, upsellItems: [MEAL] }, availableCombos: [MEAL] })
    );
    renderPrompt();
    const card = screen.getByTestId("miam-combo-combo-1");
    expect(card).toHaveTextContent(/£100(?![\d.])/);
    expect(card).not.toHaveTextContent("£100.00");
  });

  // …and its saving as posistKiosk prints every "save" figure (savePill:
  // moduloCalcaledValue), so the card never mixes "£7" with "Save £3.00".
  it.each([
    [10, "Save £3"],
    [10.5, "Save £3.50"],
  ])("the Save pill over a was-price of £%s reads '%s'", (originalPrice, pill) => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    const MEAL = { ...COMBO, price: 7, originalPrice };
    store.dispatch(
      openMakeItAMealModal({ isOpen: true, selectedItem: { ...BURGER, upsellItems: [MEAL] }, availableCombos: [MEAL] })
    );
    renderPrompt();
    expect(screen.getByTestId("miam-combo-combo-1")).toHaveTextContent(new RegExp(`^${pill}(?![\\d.])`));
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
    // A plain add confirms (user 2026-10-14): the prompt's decline adds over
    // /menu — a Complete Your Meal tap's prompt too, its bag closed on the
    // way — so the product-added modal opens on the original.
    expect(selectAddToCartModal(state)).toBe(true);
    expect(selectAddToCartItem(state)).toMatchObject({ id: "burger-1" });
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
    // …and confirms with the product-added modal on the combo (user 2026-10-14).
    expect(selectAddToCartModal(state)).toBe(true);
    expect(selectAddToCartItem(state)).toMatchObject({ id: "combo-1" });
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

/*
  audit-fixes B3: accepting a combo that opens /customization (a sized combo,
  or a combo meal with its own groups) reports CustomizationOpenedViaMIAM
  ONCE, with the raw primary-language name (names are translated only at
  render \u2014 never in analytics). A plain combo is a straight add: no event.
*/
describe("MakeItAMealPrompt \u2014 CustomizationOpenedViaMIAM (audit-fixes B3)", () => {
  const SIZED = {
    ...COMBO,
    id: "combo-sized",
    hasVariant: true,
    isVariant: false,
    variants: [
      { id: "combo-r", name: "Regular", price: 7.99 },
      { id: "combo-l", name: "Large", price: 9.99 },
    ],
  };
  const MEAL = { ...COMBO, id: "combo-meal", modifiers: ["meal_drink"] };
  const opened = () =>
    mockCapture.mock.calls.filter(([event]) => event === KioskEventName.CustomizationOpenedViaMIAM);

  const acceptOn = async (combo: Record<string, unknown>) => {
    store.dispatch(
      openMakeItAMealModal({ isOpen: true, selectedItem: { ...BURGER, upsellItems: [combo] }, availableCombos: [combo] })
    );
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
    await userEvent.click(screen.getByTestId(`miam-combo-${String(combo.id)}`));
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    // MEAL's group is live on the menu: an all-dead one sells as one tap (UB6).
    store.dispatch(setModifiersMap({ modifiersMap: { meal_drink: { _id: "meal_drink", isActive: true } } }));
    mockCapture.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it.each([
    ["a sized combo (the size picker)", SIZED],
    ["a combo meal with its own groups (the tier-1 session)", MEAL],
  ])("%s: ONE event with the combo's id and name, then the PDP", async (_label, combo) => {
    await acceptOn(combo);

    expect(opened()).toEqual([
      [KioskEventName.CustomizationOpenedViaMIAM, { item_id: combo.id, item_name: "Dream Box" }],
    ]);
    expect(await screen.findByTestId("pdp-route")).toBeInTheDocument();
  });

  it("a plain combo is a straight add: no event", async () => {
    await acceptOn(COMBO);

    expect(opened()).toEqual([]);
    expect(selectCart(store.getState()).cartItems).toHaveLength(1);
  });

  it("an Arabic session still reports the raw primary-language name, never the alias", async () => {
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });

    await acceptOn({ ...SIZED, aliases: [{ value: "\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0623\u062d\u0644\u0627\u0645", name: "Arabic", code: "ar" }] });

    expect(opened()).toEqual([
      [KioskEventName.CustomizationOpenedViaMIAM, { item_id: "combo-sized", item_name: "Dream Box" }],
    ]);
  });
});

/*
  walk-oos 2 (user 2026-10-14, "Show it Unavailable"): a combo whose required
  group has every option out of stock can never be completed — the prompt
  never offers it, and offers it again once the stock data brings one back.
*/
describe("MakeItAMealPrompt — walk-oos 2: a combo no guest can complete", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("is never offered — the live one is; PAY's map brings its drink back and it is offered again", () => {
    store.dispatch(
      setModifiersMap({
        modifiersMap: {
          meal_drink: {
            _id: "meal_drink",
            isActive: true,
            min: 1,
            max: 1,
            constituentItems: [{ id: "cola", isActive: true, outOfStock: true }],
          },
        },
      })
    );
    const DEAD = { ...COMBO, id: "combo-dead", name: "Cravings Box", modifiers: ["meal_drink"] };
    store.dispatch(
      openMakeItAMealModal({
        isOpen: true,
        selectedItem: { ...BURGER, upsellItems: [DEAD, COMBO] },
        availableCombos: [DEAD, COMBO],
      })
    );
    renderPrompt();

    expect(screen.queryByTestId("miam-combo-combo-dead")).not.toBeInTheDocument();
    expect(screen.getByTestId("miam-combo-combo-1")).toBeInTheDocument();

    act(() => {
      store.dispatch(setOutOfStockItems({ cola: { type: "combo", inStock: true } }));
    });
    expect(screen.getByTestId("miam-combo-combo-dead")).toBeInTheDocument();
  });
});
