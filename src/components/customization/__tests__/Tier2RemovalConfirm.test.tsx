import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  confirmTier1CustomizationRemoval,
  MIAMTier2Open,
  openMakeItAMealSession,
  openTier2EditModal,
  selectConfirmTier1CustomizationRemoval,
  setTeir2SelectedEntity,
  setTier1BottomSheetAndSelectedEntity,
  setTier1SelectedCustomization,
  setTier2BottomSheet,
  setTier2CustomizationModalForConfirmation,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency, setHidePlusIconFromItem } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Tier2CustomizationSheet from "../Tier2CustomizationSheet";
import Customization from "../../../pages/Customization";
import i18n from "../../../i18n";

/*
  Item 24 (lane bag-pdp): in a tier-2 EDIT with the hide-plus setting on, "−"
  at quantity 1 asks before removing the tier-1 pick (today a dead tap: the
  flag had no consumer). YES drops exactly that pick from the LIVE tier-1 map
  — matched by itemId, in the tier-2 session's own group (the fork read
  `group.id` from a `_id` object and wrote an "undefined" key that made PDP
  pricing throw) — clears the flag and closes WITHOUT the discard prompt; NO
  keeps it. NEW mode never asks, and every close path clears the flag.
*/

type Pick = Record<string, unknown>;

const ICE = {
  _id: "dl_addons",
  name: "Ice Level",
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "ice", name: "Regular Ice", price: 0, isActive: true }],
};
/** A slot that takes two drinks — so a duplicate pick of the same item exists. */
const DRINKS = {
  _id: "pack1_2_combo",
  name: "Drinks",
  type: "Combo",
  min: 1,
  max: 2,
  multiplePunchMin: 1,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 2,
  order: 2,
  isActive: true,
  constituentItems: [{ id: "d-large", name: "Large Cola", price: 0.75, isActive: true, modifiers: [ICE._id] }],
};
const SIDES_ID = "pack1_3_combo";

const COLA_1: Pick = {
  id: "d-large",
  name: "Large Cola",
  price: 0.75,
  quantity: 1,
  itemId: "1700000000001_d-large",
  modifiers: [ICE._id],
  customizations: { [ICE._id]: [{ id: "ice", name: "Regular Ice", price: 0, quantity: 1 }] },
};
const COLA_2: Pick = { ...COLA_1, itemId: "1700000000002_d-large" };
const FRIES: Pick = { id: "fries", name: "Fries", price: 0, quantity: 1 };

const tier1Map = () => ({ [DRINKS._id]: [COLA_1, COLA_2], [SIDES_ID]: [FRIES] });

/** openTier2EditModal's reducer takes an untyped action (the creator types its payload as void). */
const openTier2Edit = (payload: Record<string, unknown>) =>
  store.dispatch({ type: openTier2EditModal.type, payload });

/** A tier-2 EDIT of COLA_2 (the second of two identical picks), hide-plus on. */
const seedEdit = (entity: Pick = COLA_2, hidePlus = true) => {
  const tier1 = tier1Map();
  store.dispatch(setModifiersMap({ modifiersMap: { [ICE._id]: ICE, [DRINKS._id]: DRINKS } }));
  store.dispatch(setHidePlusIconFromItem(hidePlus));
  store.dispatch(setTier1SelectedCustomization(tier1));
  openTier2Edit({
    customizations: { selectedEntity: { ...entity }, selectedCustomizations: entity.customizations },
    bottomSheet: { isOpen: true, type: "customizableItem", openType: "edit" },
    groupId: DRINKS._id,
    // The fork's source of the group: a modifier group carries `_id`, never `id`.
    currentCustomizations: { selectedCustomizations: tier1, group: DRINKS },
  });
};

/** A tier-2 NEW session on a fresh pick at quantity 1. */
const seedNew = () => {
  const tier1 = { [DRINKS._id]: [], [SIDES_ID]: [FRIES] };
  store.dispatch(setModifiersMap({ modifiersMap: { [ICE._id]: ICE, [DRINKS._id]: DRINKS } }));
  store.dispatch(setHidePlusIconFromItem(true));
  store.dispatch(setTier1SelectedCustomization(tier1));
  store.dispatch(
    setTeir2SelectedEntity({
      entity: { id: "d-large", name: "Large Cola", price: 0.75, quantity: 1, modifiers: [ICE._id] },
      groupId: DRINKS._id,
      currentCustomizations: { selectedCustomizations: tier1, group: DRINKS },
    }),
  );
  store.dispatch(
    setTier2BottomSheet({ isOpen: true, type: "customizableItem", openType: "new", status: "", editCustomizationContent: {} }),
  );
};

const renderSheet = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Tier2CustomizationSheet />
      </MemoryRouter>
    </Provider>,
  );

const flag = () => Boolean(selectConfirmTier1CustomizationRemoval(store.getState()));
const drinks = () => (tier1SelectedCustomization(store.getState()) as Record<string, Pick[]>)[DRINKS._id];
const tap = (testId: string) => fireEvent.click(screen.getByTestId(testId));

describe("Tier2CustomizationSheet — the tier-1 removal confirm (item 24)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
  });

  it("EDIT, qty 1, hide-plus on: '−' opens the removal confirm — an alertdialog, focus on its primary; not the discard prompt", () => {
    seedEdit();
    renderSheet();
    expect(screen.queryByTestId("tier2-qty-increase")).not.toBeInTheDocument(); // hide-plus
    tap("tier2-qty-decrease");

    expect(flag()).toBe(true);
    const dialog = screen.getByRole("alertdialog", { name: i18n.t("pdp.discardTitle") });
    expect(dialog).toHaveAttribute("data-testid", "tier2-remove-overlay");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(i18n.t("pdp.discardBody"));
    expect(screen.getByTestId("tier2-remove-confirm")).toHaveTextContent(i18n.t("pdp.discardConfirm"));
    expect(screen.getByTestId("tier2-remove-cancel")).toHaveTextContent(i18n.t("pdp.discardKeep"));
    expect(screen.getByTestId("tier2-remove-confirm")).toHaveFocus();
    expect(screen.queryByTestId("tier2-discard-overlay")).not.toBeInTheDocument();
    expect(drinks()).toHaveLength(2); // nothing removed yet
  });

  it("YES removes exactly the edited pick (by itemId) from the live map, writes no new key, clears the flag, closes with no discard prompt", () => {
    seedEdit();
    renderSheet();
    const before = tier1SelectedCustomization(store.getState()) as Record<string, Pick[]>;
    tap("tier2-qty-decrease");
    tap("tier2-remove-confirm");

    const after = tier1SelectedCustomization(store.getState()) as Record<string, Pick[]>;
    expect(after[DRINKS._id]).toEqual([COLA_1]); // the duplicate with the OTHER itemId stays
    expect(after[SIDES_ID]).toEqual(before[SIDES_ID]);
    expect(Object.keys(after).sort()).toEqual([DRINKS._id, SIDES_ID].sort());
    expect(after).not.toHaveProperty("undefined");
    expect(flag()).toBe(false);
    expect(MIAMTier2Open(store.getState())).toBe(false);
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tier2-discard-overlay")).not.toBeInTheDocument();
  });

  it("an id-only pick (no itemId) is matched by id — the first one only", () => {
    const tier1 = { [DRINKS._id]: [{ id: "d-large", quantity: 1 }, { id: "d-large", quantity: 1, note: "second" }] };
    store.dispatch(setModifiersMap({ modifiersMap: { [ICE._id]: ICE, [DRINKS._id]: DRINKS } }));
    store.dispatch(setHidePlusIconFromItem(true));
    store.dispatch(setTier1SelectedCustomization(tier1));
    openTier2Edit({
      customizations: { selectedEntity: { id: "d-large", name: "Large Cola", quantity: 1, modifiers: [ICE._id] }, selectedCustomizations: {} },
      bottomSheet: { isOpen: true, type: "customizableItem", openType: "edit" },
      groupId: DRINKS._id,
      currentCustomizations: { selectedCustomizations: tier1, group: DRINKS },
    });
    renderSheet();
    tap("tier2-qty-decrease");
    tap("tier2-remove-confirm");
    expect(drinks()).toEqual([{ id: "d-large", quantity: 1, note: "second" }]);
  });

  it("NO keeps the pick and the sheet, and clears the flag", () => {
    seedEdit();
    renderSheet();
    tap("tier2-qty-decrease");
    tap("tier2-remove-cancel");
    expect(screen.queryByTestId("tier2-remove-overlay")).not.toBeInTheDocument();
    expect(drinks()).toEqual([COLA_1, COLA_2]);
    expect(MIAMTier2Open(store.getState())).toBe(true);
    expect(screen.getByTestId("tier2-sheet")).toBeInTheDocument();
    expect(flag()).toBe(false);
  });

  it("NEW mode never asks: '−' at qty 1 closes the sheet; a stale flag never shows the confirm there", () => {
    seedNew();
    renderSheet();
    act(() => {
      store.dispatch(confirmTier1CustomizationRemoval(true));
    });
    expect(screen.queryByTestId("tier2-remove-overlay")).not.toBeInTheDocument();
    tap("tier2-qty-decrease");
    expect(screen.queryByTestId("tier2-remove-overlay")).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(false);
    expect(flag()).toBe(false); // the close path cleared it
  });

  it("hide-plus OFF: '−' at qty 1 in an EDIT does not ask (today's close)", () => {
    seedEdit(COLA_2, false);
    renderSheet();
    tap("tier2-qty-decrease");
    expect(screen.queryByTestId("tier2-remove-overlay")).not.toBeInTheDocument();
    expect(flag()).toBe(false);
    expect(drinks()).toHaveLength(2);
  });

  it("qty 2 in an EDIT: '−' just decrements", () => {
    seedEdit({ ...COLA_2, quantity: 2 });
    renderSheet();
    tap("tier2-qty-decrease");
    expect(screen.getByTestId("tier2-qty")).toHaveTextContent("1");
    expect(screen.queryByTestId("tier2-remove-overlay")).not.toBeInTheDocument();
    expect(flag()).toBe(false);
  });

  describe("every close path clears the flag", () => {
    it("the X", () => {
      seedEdit();
      renderSheet();
      tap("tier2-qty-decrease");
      expect(flag()).toBe(true);
      tap("tier2-sheet-close");
      expect(flag()).toBe(false);
      expect(screen.queryByTestId("tier2-remove-overlay")).not.toBeInTheDocument();
      expect(drinks()).toHaveLength(2);
    });

    it("the discard prompt's confirm", () => {
      seedNew();
      renderSheet();
      tap("tier2-option-ice"); // dirty NEW session → X asks to discard
      tap("tier2-sheet-close");
      expect(screen.getByTestId("tier2-discard-overlay")).toBeInTheDocument();
      act(() => {
        store.dispatch(confirmTier1CustomizationRemoval(true));
      });
      tap("tier2-discard-confirm");
      expect(flag()).toBe(false);
      expect(MIAMTier2Open(store.getState())).toBe(false);
    });

    it("never stacked: the removal confirm stays hidden while the discard prompt is up", () => {
      seedNew();
      renderSheet();
      tap("tier2-option-ice");
      tap("tier2-sheet-close");
      act(() => {
        store.dispatch(confirmTier1CustomizationRemoval(true));
      });
      expect(screen.getByTestId("tier2-discard-overlay")).toBeInTheDocument();
      expect(screen.queryByTestId("tier2-remove-overlay")).not.toBeInTheDocument();
    });

    // mutation-verifier addition: the case above is a NEW session, where the
    // removal confirm is off anyway — the guard only matters in an EDIT.
    it("never stacked in an EDIT either: a discard prompt hides an open removal confirm", () => {
      seedEdit();
      renderSheet();
      tap("tier2-qty-decrease");
      expect(screen.getByTestId("tier2-remove-overlay")).toBeInTheDocument();
      act(() => {
        store.dispatch(setTier2CustomizationModalForConfirmation(true));
      });
      expect(screen.getByTestId("tier2-discard-overlay")).toBeInTheDocument();
      expect(screen.queryByTestId("tier2-remove-overlay")).not.toBeInTheDocument();
    });
  });
});

describe("item 24 on the PDP: the emptied slot is priced and caught by the completion warning (item 23)", () => {
  beforeAll(async () => {
    Element.prototype.scrollTo = () => {};
    await import("../../cart/bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
  });

  it("YES → the PDP total drops the pick's price (no throw) and ADD TO BAG names the emptied slot", async () => {
    const SINGLE = { ...DRINKS, max: 1, multiplePunchMax: 1, multiplePunchMaxItem: 1 };
    store.dispatch(setModifiersMap({ modifiersMap: { [ICE._id]: ICE, [SINGLE._id]: SINGLE } }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
        selectedEntity: { id: "pack1", name: "Dream Box", price: 25, applyAddonsPrice: true, modifiers: [SINGLE._id] },
      }),
    );
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/customization"]}>
          <Customization />
        </MemoryRouter>
      </Provider>,
    );
    act(() => {
      store.dispatch(setHidePlusIconFromItem(true));
      store.dispatch(setTier1SelectedCustomization({ [SINGLE._id]: [COLA_1] }));
    });
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£25.75");

    act(() => {
      openTier2Edit({
        customizations: { selectedEntity: { ...COLA_1 }, selectedCustomizations: COLA_1.customizations },
        bottomSheet: { isOpen: true, type: "customizableItem", openType: "edit" },
        groupId: SINGLE._id,
        currentCustomizations: { selectedCustomizations: { [SINGLE._id]: [COLA_1] }, group: SINGLE },
      });
    });
    tap("tier2-qty-decrease");
    tap("tier2-remove-confirm");

    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£25.00");
    await act(async () => {
      fireEvent.click(screen.getByTestId("pdp-add-to-bag"));
    });
    expect(document.getElementById("pdp-incomplete-message")?.textContent).toBe(
      "Please choose your drinks before adding to your bag",
    );
  });
});
