import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import "../../../i18n";

/*
  Walk 2026-10-14: an imageless item's PDP hero was a bare 450 px grey band
  that read as a failed load. It carries the faint brand bell (NoImageBell)
  — only when the item has no photo. Seam: navigation (the no-session guard).
*/

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

const PHOTO = "https://cdn.example.com/kiosk/americano.png";
const AMERICANO = { id: "americano", name: "Americano", price: 0.5, modifiers: [] };

const renderPdp = (entity: Record<string, unknown>) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: {} }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
      selectedEntity: entity,
    }),
  );
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
      </MemoryRouter>
    </Provider>,
  );
};

/** The hero band: the scroller's first child (Figma 1:598). */
const hero = () => screen.getByTestId("customization-screen").querySelector("#scrollCustomizableItem > div") as HTMLElement;

describe("PDP hero without a photo (walk 2026-10-14)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("an imageless item: the bell centred in the 1080 × 450 grey band, no <img>", () => {
    renderPdp(AMERICANO);

    expect(hero()).toHaveClass("h-[450px]", "w-[1080px]", "items-center", "justify-center", "bg-tb-grey-6");
    expect(hero().querySelector('[data-testid="no-image-bell"]')).toHaveClass("h-full", "w-full");
    expect(hero().querySelector("img")).toBeNull();
  });

  it("an item with a photo: the 680 × 354 photo, never the bell", () => {
    renderPdp({ ...AMERICANO, aggregator_image: [{ aggreagtorName: "kiosk", png: PHOTO }] });

    expect(hero().querySelector('[data-testid="no-image-bell"]')).toBeNull();
    expect(hero().querySelector("img")).toHaveAttribute("src", PHOTO);
  });
});
