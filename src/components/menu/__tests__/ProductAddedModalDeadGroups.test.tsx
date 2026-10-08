import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { mutateAddToCartModal } from "../../../redux/features/menuSelections/menuSelections.slice";
import ProductAddedModal from "../ProductAddedModal";
import "../../../i18n";

/*
  UB6 Fix B wiring — the "product added" You Might Like strip reads the
  menu-sellable entity map like every other suggestion surface: a pack whose
  groups are all dead is never offered, and a plain item whose groups are all
  dead is handed to quick add in the menu's one-tap shape (`modifiers: []`).
  The modal is opened directly here; WHEN it opens is residual R1.
*/
const DEAD_PACK = { id: "deadpack", name: "Dream box", price: 25, modifiers: ["dp_1_combo", "dp_2_combo"] };
const DEAD_PLAIN = { id: "nachos", name: "Nachos", price: 4, modifiers: ["gone_addons"] };
const LIVE_PLAIN = { id: "taco", name: "Crunchy Taco", price: 2, modifiers: ["taco_addons"] };

describe("ProductAddedModal — dead modifier groups (UB6)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: { taco_addons: { _id: "taco_addons", isActive: true } } }));
    store.dispatch(setEntityMap({ entityMap: { deadpack: DEAD_PACK, nachos: DEAD_PLAIN, taco: LIVE_PLAIN } }));
    store.dispatch(
      mutateAddToCartModal({ isOpen: true, item: { id: "burrito", recommendedItems: ["deadpack", "nachos", "taco"] } })
    );
  });

  it("the strip offers the dead plain item and the live one, never the dead pack; quick add hands over modifiers []", () => {
    const onQuickAdd = vi.fn();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ProductAddedModal onQuickAdd={onQuickAdd} />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByTestId("added-rec-deadpack")).not.toBeInTheDocument();
    expect(screen.getByTestId("added-rec-nachos")).toBeInTheDocument();
    expect(screen.getByTestId("added-rec-taco")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("added-rec-add-nachos"));

    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd.mock.calls[0]?.[0]).toMatchObject({ id: "nachos", modifiers: [] });
  });
});
