import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  MIAMTier2Open,
  openTier2EditModal,
  setTeir2SelectedEntity,
  setTier1SelectedCustomization,
  setTier2BottomSheet,
  tier1SelectedCustomization,
  tier2SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  selectErrorMessageGlobal,
  selectShowErrorModalGlobal,
  setAllowMultiplePunch,
  setCurrency,
  setHidePlusIconFromItem,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { setOutOfStockItems } from "../../../redux/features/menuSelections/menuSelections.slice";
import Tier2CustomizationSheet from "../Tier2CustomizationSheet";
import i18n from "../../../i18n";

/** Parent (tier-1) slot group the tier-2 result lands back into. */
const SLOT_GROUP = {
  _id: "pack1_2_combo",
  name: "Drink",
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 2,
  isActive: true,
};

/** REQUIRED nested group (min 1) on the tier-2 entity. */
const ICE_GROUP = {
  _id: "dl_addons",
  name: "Ice Level",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "ice", name: "Regular Ice", price: 0, isActive: true },
    { id: "no-ice", name: "No Ice", price: 0, isActive: true },
  ],
};

/** The tier-2 entity being customized (a slot constituent with own groups). */
const ENTITY = {
  id: "d-large",
  name: "Large Cola",
  price: 0.75,
  quantity: 1,
  modifiers: ["dl_addons"],
};

const TIER1_SELECTIONS = { [SLOT_GROUP._id]: [] };

const seedOpenTier2 = (entity: object = ENTITY, group: object = ICE_GROUP) => {
  store.dispatch(setModifiersMap({ modifiersMap: { dl_addons: group } }));
  store.dispatch(setTier1SelectedCustomization(TIER1_SELECTIONS));
  store.dispatch(
    setTeir2SelectedEntity({
      entity,
      groupId: SLOT_GROUP._id,
      currentCustomizations: {
        selectedCustomizations: TIER1_SELECTIONS,
        group: SLOT_GROUP,
      },
    })
  );
  store.dispatch(
    setTier2BottomSheet({
      isOpen: true,
      type: "customizableItem",
      openType: "new",
      status: "",
      editCustomizationContent: {},
    })
  );
};

const renderSheet = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Tier2CustomizationSheet />
      </MemoryRouter>
    </Provider>
  );

describe("Tier2CustomizationSheet (P6c — nested customize sheet)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the sheet's error path auto-scrolls.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("renders nothing while the tier-2 modal is closed", () => {
    renderSheet();
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });

  it("open (new): shows the entity header, its groups and options, qty and price line", () => {
    seedOpenTier2();
    renderSheet();
    const sheet = screen.getByTestId("tier2-sheet");
    expect(sheet).toHaveTextContent("Large Cola");
    expect(screen.getByTestId("tier2-group-dl_addons")).toHaveTextContent(
      "Ice Level"
    );
    expect(screen.getByTestId("tier2-option-ice")).toBeInTheDocument();
    expect(screen.getByTestId("tier2-option-no-ice")).toBeInTheDocument();
    expect(screen.getByTestId("tier2-qty")).toHaveTextContent("1");
    expect(screen.getByTestId("tier2-price-line")).toHaveTextContent("0.75");
    // required nested group seeded empty in redux
    expect(tier2SelectedCustomization(store.getState())).toEqual({
      dl_addons: [],
    });
  });

  it("multi-pick option steppers are named per item, so screen readers can tell the rows apart", () => {
    const SAUCES = {
      ...ICE_GROUP,
      name: "Sauces",
      min: 0,
      max: 2,
      multiplePunchMin: 0,
      multiplePunchMax: 2,
      multiplePunchMaxItem: 2,
      constituentItems: [
        { id: "salsa", name: "Salsa", price: 0, isActive: true },
        { id: "ranch", name: "Ranch", price: 0, isActive: true },
      ],
    };
    seedOpenTier2(ENTITY, SAUCES);
    renderSheet();
    for (const item of ["Salsa", "Ranch"]) {
      expect(
        screen.getByRole("button", { name: `${i18n.t("pdp.increase")} ${item}` })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `${i18n.t("pdp.decrease")} ${item}` })
      ).toBeInTheDocument();
    }
  });

  it("SAVE with an unsatisfied min: no commit, errored ring + global error, sheet stays open", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-sheet-save"));

    const state = store.getState();
    expect(MIAMTier2Open(state)).toBe(true); // still open
    expect(tier1SelectedCustomization(state)).toEqual(TIER1_SELECTIONS); // untouched
    expect(selectShowErrorModalGlobal(state)).toBe(true);
    expect(selectErrorMessageGlobal(state)).toBe(
      "Please check the customization errors"
    );
    expect(screen.getByTestId("tier2-group-dl_addons")).toHaveClass(
      "ring-red-500",
      "tb-shake" // motion §3.8: the unfinished group shakes
    );
  });

  it("pick + SAVE commits the nested row into the tier-1 selections and closes", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    expect(
      tier2SelectedCustomization(store.getState()).dl_addons
    ).toHaveLength(1);

    await userEvent.click(screen.getByTestId("tier2-sheet-save"));

    const state = store.getState();
    const tier1 = tier1SelectedCustomization(state);
    expect(tier1[SLOT_GROUP._id]).toHaveLength(1);
    const row = tier1[SLOT_GROUP._id][0];
    expect(row).toMatchObject({
      id: "d-large",
      name: "Large Cola",
      quantity: 1,
      isActive: true,
      isConfigurationError: false,
    });
    // unique tier-1 row id: `${Date.now()}_${entity.id}`
    expect(String(row.itemId)).toMatch(/_d-large$/);
    // the nested pick travels on the row
    expect(row.customizations.dl_addons).toHaveLength(1);
    expect(row.customizations.dl_addons[0]).toMatchObject({
      id: "ice",
      quantity: 1,
    });
    expect(MIAMTier2Open(state)).toBe(false);
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });

  it("X on a dirty NEW session asks to discard; confirming closes without committing", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));

    // discard-confirm overlay, not an instant close
    expect(screen.getByTestId("tier2-discard-overlay")).toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(true);

    await userEvent.click(screen.getByTestId("tier2-discard-confirm"));
    const state = store.getState();
    expect(MIAMTier2Open(state)).toBe(false);
    expect(tier1SelectedCustomization(state)).toEqual(TIER1_SELECTIONS);
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });

  it("the confirm (shared by discard and the item-24 removal) is an alertdialog named by its copy, focus on Keep editing (the safe choice)", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));

    const dialog = screen.getByRole("alertdialog", { name: "Are you sure?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Your customizations will be lost");
    expect(screen.getByTestId("tier2-discard-cancel")).toHaveFocus();
    expect(screen.getByTestId("tier2-discard-confirm")).not.toHaveFocus();
  });

  it("'Keep editing' dismisses the discard prompt and keeps the session", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));
    await userEvent.click(screen.getByTestId("tier2-discard-cancel"));

    expect(
      screen.queryByTestId("tier2-discard-overlay")
    ).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(true);
    expect(screen.getByTestId("tier2-sheet")).toBeInTheDocument();
  });

  it("X on a clean NEW session closes immediately without a discard prompt", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));

    expect(
      screen.queryByTestId("tier2-discard-overlay")
    ).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(false);
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });
});

/*
  P9f §2.6: the header's calories (entityCal) and each option's meta line
  (itemMeta) go through t("pack.cal") — EN byte-identical, never "Cal" in AR.
*/
describe("Tier2CustomizationSheet calories (P9f)", () => {
  const CAL_ENTITY = { ...ENTITY, calorieCount: 360 };
  const CAL_GROUP = {
    ...ICE_GROUP,
    constituentItems: [
      { id: "ice", name: "Regular Ice", price: 0.5, calorieCount: 10, isActive: true },
      { id: "no-ice", name: "No Ice", price: 0, isActive: true },
    ],
  };

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("EN is unchanged: '£0.75 | 360 Cal' header and '+£0.50 | 10 Cal' option", () => {
    seedOpenTier2(CAL_ENTITY, CAL_GROUP);
    renderSheet();

    expect(screen.getByTestId("tier2-price-line")).toHaveTextContent("£0.75 | 360 Cal");
    expect(screen.getByTestId("tier2-option-ice")).toHaveTextContent("+£0.50 | 10 Cal");
  });

  it("AR renders t('pack.cal') in both and never 'Cal'", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    seedOpenTier2(CAL_ENTITY, CAL_GROUP);
    renderSheet();

    const header = screen.getByTestId("tier2-price-line");
    const option = screen.getByTestId("tier2-option-ice");
    expect(header).toHaveTextContent(i18n.t("pack.cal", { value: 360 }));
    expect(option).toHaveTextContent(i18n.t("pack.cal", { value: 10 }));
    expect(header).not.toHaveTextContent("Cal");
    expect(option).not.toHaveTextContent("Cal");
  });
});

/*
  Lane figma-polish item 42 (D4) — tier-2 is the full-screen CUSTOMIZE page
  (Figma 1:2984 / 1:5051 family): a z-60 page with no backdrop, ONE scroller
  (#scrollCustomizableItem2 — the hook's AutoScroll target) holding the
  Hero/Customize band, the Counter and the group sections, and the 148 px CTA
  bar pinned below it: BACK (tier2-sheet-close, the discard-prompt rule) and
  UPDATE (tier2-sheet-save, the same commit for new and edit sessions). The
  confirms stay at z-70, above the page.
*/
describe("Tier2CustomizationSheet — the full-screen CUSTOMIZE page (item 42)", () => {
  /** A tier-1 pick of Large Cola already customized with Regular Ice. */
  const COLA_EDIT = {
    ...ENTITY,
    itemId: "1700000000001_d-large",
    customizations: { dl_addons: [{ id: "ice", name: "Regular Ice", price: 0, quantity: 1 }] },
  };
  const FRIES_PICK = { id: "fries", name: "Fries", price: 0, quantity: 1, itemId: "1700000000002_fries" };
  const EDIT_GROUP = { ...SLOT_GROUP, max: 2, multiplePunchMax: 2, multiplePunchMaxItem: 2 };

  /** openTier2EditModal's reducer takes an untyped payload (Tier2RemovalConfirm's seam). */
  const seedEditTier2 = (hidePlus = false) => {
    const tier1 = { [SLOT_GROUP._id]: [COLA_EDIT, FRIES_PICK] };
    store.dispatch(setModifiersMap({ modifiersMap: { dl_addons: ICE_GROUP } }));
    store.dispatch(setHidePlusIconFromItem(hidePlus));
    store.dispatch(setTier1SelectedCustomization(tier1));
    store.dispatch({
      type: openTier2EditModal.type,
      payload: {
        customizations: { selectedEntity: { ...COLA_EDIT }, selectedCustomizations: COLA_EDIT.customizations },
        bottomSheet: { isOpen: true, type: "customizableItem", openType: "edit" },
        groupId: SLOT_GROUP._id,
        currentCustomizations: { selectedCustomizations: tier1, group: EDIT_GROUP },
      },
    });
  };
  const scroller = () => document.getElementById("scrollCustomizableItem2") as HTMLElement;
  const slotPicks = () =>
    (tier1SelectedCustomization(store.getState()) as Record<string, Array<Record<string, unknown>>>)[SLOT_GROUP._id];

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  });

  it("page structure: the z-60 page (no backdrop); the band, the Counter and the sections in #scrollCustomizableItem2; BACK + UPDATE pinned below", () => {
    seedOpenTier2();
    renderSheet();
    const page = screen.getByTestId("tier2-sheet");

    expect(page).toHaveClass("absolute", "inset-0", "z-[60]", "flex", "flex-col", "bg-tb-surface");
    expect(page.querySelector('[aria-hidden][class*="bg-tb-purple-vibrant"]')).toBeNull();
    expect(page).toContainElement(scroller());
    expect(scroller()).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");

    // Hero/Customize (1:4924): CUSTOMIZE, the 328 × 202 image box, the name (the h2) and the price line.
    const band = scroller().firstElementChild as HTMLElement;
    expect(band).toHaveClass("min-h-[450px]", "bg-tb-grey-6");
    const title = within(band).getByText(i18n.t("pack.customize"));
    expect(title.tagName).toBe("P");
    expect(title).toHaveClass("tb-display", "text-[32px]", "leading-[32px]", "text-tb-purple");
    const imageBox = band.querySelector(".h-\\[202px\\].w-\\[328px\\]") as HTMLElement;
    expect(imageBox).not.toBeNull();
    // No photo (walk 2026-10-14): the faint bell fills the box, never a bare band.
    expect(within(imageBox).getByTestId("no-image-bell")).toBeInTheDocument();
    expect(imageBox.querySelector("img")).toBeNull();
    expect(within(band).getByRole("heading", { level: 2 })).toHaveTextContent("Large Cola");
    expect(band).toContainElement(screen.getByTestId("tier2-price-line"));

    // The Counter and the sections scroll with the page; a section's id is the AutoScroll anchor.
    for (const id of ["tier2-qty-decrease", "tier2-qty", "tier2-qty-increase", "tier2-group-dl_addons", "tier2-option-ice"]) {
      expect(scroller()).toContainElement(screen.getByTestId(id));
    }
    expect(screen.getByTestId("tier2-group-dl_addons")).toHaveAttribute("id", "dl_addons");
    expect(screen.getByTestId("tier2-option-ice")).toHaveAttribute("aria-pressed", "false");

    // CTA/Bottom screen (1:589): BACK + UPDATE, outside the scroller.
    const back = screen.getByTestId("tier2-sheet-close");
    const update = screen.getByTestId("tier2-sheet-save");
    expect(scroller()).not.toContainElement(back);
    expect(scroller()).not.toContainElement(update);
    expect(back).toHaveTextContent(i18n.t("pdp.back"));
    expect(update).toHaveTextContent(i18n.t("bag.update"));
    expect(update.parentElement).toHaveClass("h-[148px]", "bg-tb-purple");
    expect(page.lastElementChild).toBe(update.parentElement);
  });

  it.each([
    ["normal", false, "703px", "790px"],
    ["ADA", true, "488px", "394px"],
  ])("the page's own scroll indicator (%s): the PDP's track geometry", (_mode, ada, top, height) => {
    if (ada) store.dispatch(toggleAccessibilityMode());
    seedOpenTier2();
    renderSheet();

    expect(screen.getByTestId("tier2-scrollbar")).toHaveStyle({ top, height });
    expect(screen.getByTestId("tier2-sheet")).toContainElement(screen.getByTestId("tier2-scrollbar"));
  });

  it("a multi-pick group's header counts Σ quantities against its max ('count of max'); a one-pick group shows none", () => {
    const SAUCES = {
      ...ICE_GROUP,
      name: "Sauces",
      min: 0,
      max: 2,
      multiplePunchMin: 0,
      multiplePunchMax: 3,
      multiplePunchMaxItem: 2,
      constituentItems: [{ id: "salsa", name: "Salsa", price: 0, isActive: true }],
    };
    seedOpenTier2(ENTITY, SAUCES);
    renderSheet();
    const group = screen.getByTestId("tier2-group-dl_addons");

    expect(group).toHaveTextContent("0 of 2");
    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("pdp.increase")} Salsa` }));
    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("pdp.increase")} Salsa` }));
    expect(group).toHaveTextContent("2 of 2");
    // The max is the EFFECTIVE one SAVE validates: multiplePunchMax under multiple punch.
    act(() => {
      store.dispatch(setAllowMultiplePunch(true));
    });
    expect(group).toHaveTextContent("2 of 3");

    cleanup();
    act(() => {
      store.dispatch({ type: "RESET_STATE" });
    });
    seedOpenTier2();
    renderSheet();
    expect(screen.getByTestId("tier2-group-dl_addons")).not.toHaveTextContent(/\bof\b/);
  });

  it("UPDATE commits an EDIT session: the same pick (by itemId) is replaced with its new nested choice, nothing added, the page closes", () => {
    seedEditTier2();
    renderSheet();
    expect(screen.getByTestId("tier2-option-ice")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("tier2-option-no-ice"));
    fireEvent.click(screen.getByTestId("tier2-sheet-save"));

    const picks = slotPicks();
    expect(picks.map((pick) => pick.itemId)).toEqual(["1700000000001_d-large", "1700000000002_fries"]);
    expect((picks[0].customizations as Record<string, Array<{ id: string }>>).dl_addons.map((item) => item.id)).toEqual([
      "no-ice",
    ]);
    expect(picks[1]).toEqual(FRIES_PICK);
    expect(MIAMTier2Open(store.getState())).toBe(false);
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });

  it("BACK on an EDIT never asks (the discard rule is NEW-only): it closes and the tier-1 pick is untouched", () => {
    seedEditTier2();
    renderSheet();

    fireEvent.click(screen.getByTestId("tier2-option-no-ice"));
    fireEvent.click(screen.getByTestId("tier2-sheet-close"));

    expect(screen.queryByTestId("tier2-discard-overlay")).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(false);
    expect(slotPicks()[0]).toEqual(COLA_EDIT);
  });

  it("the confirms stay at z-70 ABOVE the z-60 page: the item-24 removal confirm and the discard prompt", async () => {
    seedEditTier2(true);
    renderSheet();
    const page = screen.getByTestId("tier2-sheet");

    fireEvent.click(screen.getByTestId("tier2-qty-decrease"));
    const removal = screen.getByTestId("tier2-remove-overlay");
    expect(removal).toHaveClass("absolute", "inset-0", "z-[70]");
    expect(removal.parentElement).toBe(page);
    fireEvent.click(screen.getByTestId("tier2-remove-cancel"));

    // A NEW session's dirty BACK → the discard prompt, the same layer.
    act(() => {
      store.dispatch({ type: "RESET_STATE" });
      seedOpenTier2();
    });
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));
    const discard = screen.getByTestId("tier2-discard-overlay");
    expect(discard).toHaveClass("absolute", "inset-0", "z-[70]");
    expect(discard.parentElement).toBe(screen.getByTestId("tier2-sheet"));
  });

  // motion-v2 MV8c: the page enters like a pushed page (its scroll body from
  // the right, under a static data-enter) and the confirm card rises — the
  // house classes, which reduced motion owns (the old inline dialog keyframes
  // painted a 24 px offset frame under reduce).
  it("enters like a page: a static data-enter root, the scroll body tb-enter, the confirm card tb-rise — no <style>, no inline animation", async () => {
    seedOpenTier2();
    const { container } = renderSheet();
    const page = screen.getByTestId("tier2-sheet");
    expect(page).toHaveAttribute("data-enter", "fwd");
    expect(page).not.toHaveAttribute("style");
    expect([...page.querySelectorAll(".tb-enter")]).toEqual([scroller()]);

    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));
    const card = screen.getByRole("alertdialog").lastElementChild; // the card above its scrim
    expect(card).toHaveClass("tb-rise", "bg-tb-surface");
    expect(card).not.toHaveAttribute("style");
    expect(container.querySelector("style")).toBeNull();
  });
});

/*
  audit-fixes UB2 on the tier-2 page (the PDP's rule, CustomizationLimits):
  the EFFECTIVE bounds pick the presentation — an effective 1/1 group is
  radio cards (a second tap swaps) even with an item cap above 1, and
  "Required" follows the effective min; the shared hook's group-max guard
  refuses a unit past the group max out loud, writing nothing.
*/
describe("Tier2CustomizationSheet — limits (audit-fixes UB2)", () => {
  /** 1/1 with an ITEM cap of 3 (it used to render steppers → "3 of 1"). */
  const DRINK = {
    ...ICE_GROUP,
    name: "Drink",
    multiplePunchMin: 0,
    multiplePunchMax: 6,
    multiplePunchMaxItem: 3,
    constituentItems: [
      { id: "cola", name: "Cola", price: 0, isActive: true },
      { id: "lemonade", name: "Lemonade", price: 0, isActive: true },
    ],
  };
  /** 0/2 stepper rows (item cap 2). */
  const SAUCES = {
    ...ICE_GROUP,
    name: "Sauces",
    min: 0,
    max: 2,
    multiplePunchMin: 0,
    multiplePunchMax: 2,
    multiplePunchMaxItem: 2,
    constituentItems: [
      { id: "salsa", name: "Salsa", price: 0, isActive: true },
      { id: "ranch", name: "Ranch", price: 0, isActive: true },
    ],
  };
  const stepperFor = (item: string) =>
    screen.queryByRole("button", { name: `${i18n.t("pdp.increase")} ${item}` });
  const picks = () =>
    (tier2SelectedCustomization(store.getState()).dl_addons ?? []).map(
      (row: { id: string; quantity: number }) => [row.id, row.quantity]
    );

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(() => {
    store.dispatch(setAllowMultiplePunch(false));
  });

  it("an effective 1/1 group with an item cap of 3 is radio cards, Required; a second tap swaps — no error", async () => {
    seedOpenTier2(ENTITY, DRINK);
    renderSheet();
    const group = screen.getByTestId("tier2-group-dl_addons");

    expect(stepperFor("Cola")).toBeNull();
    expect(within(group).getByText(i18n.t("pdp.required"))).toBeInTheDocument();
    expect(group).not.toHaveTextContent(/\bof\b/);
    expect(screen.getByTestId("tier2-option-cola")).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByTestId("tier2-option-cola"));
    await userEvent.click(screen.getByTestId("tier2-option-lemonade"));

    expect(picks()).toEqual([["lemonade", 1]]);
    expect(screen.getByTestId("tier2-option-lemonade")).toHaveAttribute("aria-pressed", "true");
    expect(selectShowErrorModalGlobal(store.getState())).toBe(false);
  });

  it("multi-punch ON: the same group reads its multi-punch bounds — no Required (min 0), '0 of 6', stepper rows", () => {
    store.dispatch(setAllowMultiplePunch(true));
    seedOpenTier2(ENTITY, DRINK);
    renderSheet();
    const group = screen.getByTestId("tier2-group-dl_addons");

    expect(within(group).queryByText(i18n.t("pdp.required"))).toBeNull();
    expect(group).toHaveTextContent(i18n.t("pdp.groupCount", { count: 0, max: 6 }));
    expect(stepperFor("Cola")).toBeInTheDocument();
  });

  it("a third Sauces unit is refused out loud: ONE global error 'You can choose up to 2 Sauces', the picks unchanged", () => {
    seedOpenTier2(ENTITY, SAUCES);
    // Spied before the mount: the hook binds dispatch at render.
    const dispatch = vi.spyOn(store, "dispatch");
    renderSheet();
    const group = screen.getByTestId("tier2-group-dl_addons");

    fireEvent.click(stepperFor("Salsa") as HTMLElement);
    fireEvent.click(stepperFor("Salsa") as HTMLElement);
    expect(picks()).toEqual([["salsa", 2]]);
    expect(group).toHaveTextContent(i18n.t("pdp.groupCount", { count: 2, max: 2 }));
    expect(selectShowErrorModalGlobal(store.getState())).toBe(false);

    dispatch.mockClear();
    fireEvent.click(stepperFor("Ranch") as HTMLElement);

    expect(dispatch.mock.calls.map(([action]) => (action as { type: string }).type)).toEqual([
      "appSettings/setShowErrorModalGlobal",
    ]);
    expect(selectErrorMessageGlobal(store.getState())).toBe("You can choose up to 2 Sauces");
    expect(picks()).toEqual([["salsa", 2]]);
    expect(group).toHaveTextContent(i18n.t("pdp.groupCount", { count: 2, max: 2 }));
    dispatch.mockRestore();
  });
});

/*
  User report 2026-10-09 — the tier-2 page's grid cards carry the PDP's CTA
  (same Menu-Item_Medium cards): CHOOSE on an unpicked card, REMOVE on a pick
  a tap takes back, nothing on a single-slot pick (a tap only re-selects it).
*/
describe("Tier2CustomizationSheet — the CTA on every grid card (user report 2026-10-09)", () => {
  const EXTRAS = {
    ...ICE_GROUP,
    name: "Extras",
    min: 0,
    max: 2,
    multiplePunchMin: 0,
    multiplePunchMax: 2,
    constituentItems: [
      { id: "lime", name: "Lime", price: 0, isActive: true },
      { id: "mint", name: "Mint", price: 0, isActive: true },
    ],
  };
  const cta = (id: string) => screen.getByTestId(`tier2-option-cta-${id}`);
  const picks = () =>
    (tier2SelectedCustomization(store.getState()).dl_addons ?? []).map(
      (row: { id: string; quantity: number }) => [row.id, row.quantity]
    );

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(() => {
    store.dispatch(setAllowMultiplePunch(false));
  });

  it("a single-slot group: CHOOSE on both cards; the pick loses its CTA, the other reads CHOOSE and swaps", async () => {
    seedOpenTier2();
    renderSheet();

    expect(cta("ice").textContent).toBe(i18n.t("pack.choose"));
    expect(cta("no-ice").textContent).toBe(i18n.t("pack.choose"));
    // ONE button named by the item (selectLabel), its CTA the description — never part of the name.
    expect(screen.getByTestId("tier2-option-ice")).toHaveAccessibleName("Regular Ice");
    expect(screen.getByTestId("tier2-option-ice")).toHaveAccessibleDescription(i18n.t("pack.choose"));

    await userEvent.click(cta("ice"));
    expect(picks()).toEqual([["ice", 1]]);
    expect(screen.queryByTestId("tier2-option-cta-ice")).toBeNull();
    // …but its box stays (hidden), so the picked card never jumps.
    expect(screen.getByTestId("tier2-option-ice").querySelector("span.invisible")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Regular Ice" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(cta("no-ice"));
    expect(picks()).toEqual([["no-ice", 1]]);
    expect(cta("ice").textContent).toBe(i18n.t("pack.choose"));
  });

  it("a flexible group: one tap on CHOOSE picks once, the CTA reads REMOVE, and REMOVE takes it back", async () => {
    seedOpenTier2(ENTITY, EXTRAS);
    renderSheet();

    await userEvent.click(cta("lime"));
    expect(picks()).toEqual([["lime", 1]]);
    expect(cta("lime").textContent).toBe(i18n.t("pack.remove"));

    await userEvent.click(cta("lime"));
    expect(picks()).toEqual([]);
    expect(cta("lime").textContent).toBe(i18n.t("pack.choose"));
  });

  it("multi-punch ON: the CTA reads the EFFECTIVE bounds the engine taps with — a raw 1/1 group with multi-punch 0/6 is no swap: its pick reads REMOVE, and REMOVE takes it back", async () => {
    store.dispatch(setAllowMultiplePunch(true));
    seedOpenTier2(ENTITY, { ...ICE_GROUP, multiplePunchMin: 0, multiplePunchMax: 6 });
    renderSheet();

    await userEvent.click(cta("ice"));
    expect(picks()).toEqual([["ice", 1]]);
    expect(cta("ice").textContent).toBe(i18n.t("pack.remove"));

    await userEvent.click(cta("ice"));
    expect(picks()).toEqual([]);
  });
});

/*
  Lane walk-oos: the tier-2 page is a chooser too (posistKiosk parity) — an
  out-of-stock nested option (the menu's stamp, or PAY's fresher feed map)
  sits last in the PDP's unavailable look and cannot be picked.
*/
describe("Tier2CustomizationSheet — out-of-stock options (walk-oos)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  const SOLD_OUT_ICE = {
    ...ICE_GROUP,
    constituentItems: [
      { id: "ice", name: "Regular Ice", price: 0, isActive: true, entityType: "Addon", outOfStock: true },
      { id: "no-ice", name: "No Ice", price: 0, isActive: true, entityType: "Addon", outOfStock: false },
    ],
  };

  it("the menu's stamp: last, named unavailable, nothing to tap — a tap picks nothing", () => {
    seedOpenTier2(ENTITY, SOLD_OUT_ICE);
    renderSheet();

    const ice = screen.getByRole("group", { name: "Regular Ice, unavailable" });
    expect(ice).toHaveAttribute("data-testid", "tier2-option-ice");
    expect(ice).toHaveTextContent(i18n.t("menu.unavailable"));
    expect(within(ice).queryByRole("button")).not.toBeInTheDocument();
    const order = Array.from(
      screen.getByTestId("tier2-group-dl_addons").querySelectorAll('[data-testid^="tier2-option-"]')
    )
      .map((node) => node.getAttribute("data-testid"))
      .filter((id) => !String(id).includes("-cta-"));
    expect(order).toEqual(["tier2-option-no-ice", "tier2-option-ice"]);
    fireEvent.click(ice);
    expect(tier2SelectedCustomization(store.getState())).toEqual({ dl_addons: [] });
  });

  it("PAY's feed map greys an option the stamp still sells", () => {
    seedOpenTier2();
    store.dispatch(
      setOutOfStockItems({ "no-ice": { _id: "no-ice", type: "addon", inStock: false } })
    );
    renderSheet();

    expect(screen.getByRole("group", { name: "No Ice, unavailable" })).toBeInTheDocument();
    expect(screen.getByTestId("tier2-option-ice").tagName).toBe("BUTTON");
  });

  // Review: the stepper rows' guard — a pack-slot session's multi-punch group.
  // Without it a sold-out option gets − / +, and "+" orders it.
  it("stepper rows: an option sold out by the menu's stamp or by PAY's feed map is named unavailable, last, has no − / +, and the picks never change", () => {
    const SAUCES = {
      ...ICE_GROUP,
      name: "Sauces",
      min: 0,
      max: 3,
      multiplePunchMin: 0,
      multiplePunchMax: 3,
      multiplePunchMaxItem: 2,
      constituentItems: [
        { id: "salsa", name: "Salsa", price: 0, isActive: true, entityType: "Addon", outOfStock: true },
        { id: "ranch", name: "Ranch", price: 0, isActive: true, entityType: "Addon", outOfStock: false },
        { id: "mayo", name: "Mayo", price: 0, isActive: true, entityType: "Addon", outOfStock: false },
      ],
    };
    seedOpenTier2(ENTITY, SAUCES);
    store.dispatch(setOutOfStockItems({ ranch: { _id: "ranch", type: "addon", inStock: false } }));
    renderSheet();

    for (const item of ["Salsa", "Ranch"]) {
      const row = screen.getByRole("group", { name: `${item}, unavailable` });
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(row).toHaveTextContent(i18n.t("menu.unavailable"));
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: `${i18n.t("pdp.increase")} ${item}` })).toBeNull();
      expect(screen.queryByRole("button", { name: `${i18n.t("pdp.decrease")} ${item}` })).toBeNull();
      fireEvent.click(row);
    }
    expect(tier2SelectedCustomization(store.getState())).toEqual({ dl_addons: [] });
    const order = Array.from(
      screen.getByTestId("tier2-group-dl_addons").querySelectorAll('[data-testid^="tier2-option-"]')
    ).map((node) => node.getAttribute("data-testid"));
    expect(order).toEqual(["tier2-option-mayo", "tier2-option-salsa", "tier2-option-ranch"]);
    // The row in stock keeps its stepper.
    expect(screen.getByRole("button", { name: `${i18n.t("pdp.increase")} Mayo` })).toBeInTheDocument();
  });
});
