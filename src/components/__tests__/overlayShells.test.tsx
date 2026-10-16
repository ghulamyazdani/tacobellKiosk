import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { openOfferRemovalModal, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { openMakeItAMealModal } from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { store } from "../../redux/app/store";
import {
  mutateAddToCartModal,
  setRecommendationDetour,
} from "../../redux/features/menuSelections/menuSelections.slice";
import OfferRemovalNotice from "../offer/OfferRemovalNotice";
import ProductAddedModal from "../menu/ProductAddedModal";
import MakeItAMealPrompt from "../makeItAMeal/MakeItAMealPrompt";
import useOfferSavings from "../../hooks/offerHooks/useOfferSavings";
import useCartTotal from "../../hooks/cartHooks/useCartTotal";
import useSellableCombos from "../../hooks/makeItAMeal/useSellableCombos";

/*
  perf REDUX-3 (a)–(c): a closed overlay is a shell — a boolean subscription —
  and its body's hooks run only while it is up. One hook only the body calls
  is spied per overlay (the real hook still runs): while closed, neither the
  mount nor a cart write may call it.
*/

vi.mock("../../hooks/offerHooks/useOfferSavings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/offerHooks/useOfferSavings")>();
  return { ...actual, default: vi.fn(actual.default) };
});
vi.mock("../../hooks/cartHooks/useCartTotal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/cartHooks/useCartTotal")>();
  return { ...actual, default: vi.fn(actual.default) };
});
vi.mock("../../hooks/makeItAMeal/useSellableCombos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/makeItAMeal/useSellableCombos")>();
  return { ...actual, default: vi.fn(actual.default) };
});

let units = 0;
/** A cart write — every body subscribes to the cart. */
const cartWrite = () =>
  act(() => {
    units += 1;
    store.dispatch(
      setCartItems([{ id: "taco", itemId: "t-1", name: "Taco", quantity: units, type: "ITEM", price: 2, total_price: 2 }])
    );
  });

const COMBO = { id: "combo-1", name: "Dream Box", price: 7.99, isActive: true, outOfStock: false, image_url: "" };
const BOX = { ...COMBO, id: "combo-2", name: "Cravings Box" };
const openPrompt = () =>
  act(() => {
    store.dispatch(
      openMakeItAMealModal({
        isOpen: true,
        selectedItem: { id: "burger-1", name: "Cheese Burger", price: 3.5, upsellItems: [COMBO, BOX] },
        availableCombos: [COMBO, BOX],
      })
    );
  });

describe("closed overlays run no body hooks (perf REDUX-3)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    vi.clearAllMocks();
  });

  it("(a) OfferRemovalNotice: none while closed; they run while it is up and stop once GOT IT closes it", () => {
    render(
      <Provider store={store}>
        <MemoryRouter>
          <OfferRemovalNotice />
        </MemoryRouter>
      </Provider>
    );
    cartWrite();
    expect(useOfferSavings).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(openOfferRemovalModal({ _id: "flat-2", name: "£2 off", type: { name: "amount", value: 2 } }));
    });
    expect(screen.getByTestId("offer-removal-notice")).toBeInTheDocument();
    expect(useOfferSavings).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("offer-removal-gotit"));
    expect(screen.queryByTestId("offer-removal-notice")).toBeNull();
    vi.mocked(useOfferSavings).mockClear();
    cartWrite();
    expect(useOfferSavings).not.toHaveBeenCalled();
  });

  it("(b) ProductAddedModal: none while closed; they run while it is open and stop once it closes", () => {
    render(
      <Provider store={store}>
        <ProductAddedModal onQuickAdd={vi.fn()} />
      </Provider>
    );
    cartWrite();
    expect(useCartTotal).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(mutateAddToCartModal({ isOpen: true, item: { id: "taco" } }));
    });
    expect(screen.getByTestId("product-added-modal")).toBeInTheDocument();
    expect(useCartTotal).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("added-continue"));
    expect(screen.queryByTestId("product-added-modal")).toBeNull();
    vi.mocked(useCartTotal).mockClear();
    cartWrite();
    expect(useCartTotal).not.toHaveBeenCalled();
  });

  // The shell keys on OPEN, not shown: through a suggestion's detour the body
  // stays mounted, so the opener it read on the open edge survives a chooser
  // that is itself a modal dialog (Select a Size). StrictMode, as main.tsx.
  it("(b) through a detour under a modal chooser, the close still returns focus to the opener", async () => {
    const Chooser = () =>
      useSelector((s: { menuSelections: { recommendationDetour: boolean } }) => s.menuSelections.recommendationDetour) ? (
        <div role="dialog" aria-modal="true">
          <button type="button" autoFocus>
            size
          </button>
        </div>
      ) : null;
    const add = () => store.dispatch(mutateAddToCartModal({ isOpen: true, item: { id: "taco" } }));
    render(
      <StrictMode>
        <Provider store={store}>
          <button type="button" onClick={add}>
            quick add
          </button>
          <ProductAddedModal onQuickAdd={vi.fn()} />
          <Chooser />
        </Provider>
      </StrictMode>
    );
    const opener = screen.getByRole("button", { name: "quick add" });
    opener.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("added-continue")).toHaveFocus();

    act(() => {
      store.dispatch(setRecommendationDetour(true));
    });
    expect(screen.getByRole("button", { name: "size" })).toHaveFocus();
    act(() => {
      store.dispatch(setRecommendationDetour(false));
    });
    expect(screen.getByTestId("added-continue")).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(screen.queryByTestId("product-added-modal")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("(c) MakeItAMealPrompt: none while closed; and the multi-combo pick still outlives a close, as when the whole prompt stayed mounted", () => {
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/menu"]}>
          <MakeItAMealPrompt />
        </MemoryRouter>
      </Provider>
    );
    cartWrite();
    expect(useSellableCombos).not.toHaveBeenCalled();

    openPrompt();
    expect(useSellableCombos).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("miam-combo-combo-2"));
    expect(screen.getByTestId("miam-combo-combo-2")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("miam-close"));
    expect(screen.queryByTestId("miam-prompt")).toBeNull();
    vi.mocked(useSellableCombos).mockClear();
    cartWrite();
    expect(useSellableCombos).not.toHaveBeenCalled();

    // The X never blacklists, so the item re-prompts — on the last pick.
    openPrompt();
    expect(screen.getByTestId("miam-combo-combo-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("miam-combo-combo-1")).toHaveAttribute("aria-pressed", "false");
  });
});
