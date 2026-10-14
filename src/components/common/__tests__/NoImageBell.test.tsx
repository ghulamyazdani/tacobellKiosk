/* eslint-disable @typescript-eslint/no-explicit-any --
 * Menu entities and cart rows flow through untyped from the legacy menu
 * converters, matching the components under test. Do not add NEW anys.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import { mutateAddToCartModal } from "../../../redux/features/menuSelections/menuSelections.slice";
import NoImageBell from "../NoImageBell";
import MenuItemCard from "../../menu/MenuItemCard";
import SelectSizeModal from "../../menu/SelectSizeModal";
import ProductAddedModal from "../../menu/ProductAddedModal";
import ForYouCard from "../../cart/ForYouCard";
import BagItemRow from "../../cart/BagItemRow";
import OptionCard, { OptionRow } from "../../customization/OptionCard";
import "../../../i18n";

/*
  Walk 2026-10-14: an item without a photo showed a bare grey band — on the
  menu card, the PDP hero, Select a Size (the arch too), the added modal's
  tiles, the suggestion cards, the buy stage, the picker rows and the bag
  rows — that read as a failed load. Every image surface now puts the faint
  brand bell (NoImageBell) in that band, and ONLY when there is no photo: a
  real image's band never carries it, loaded or not.
*/

const PHOTO = "https://cdn.example.com/kiosk/photo.png";
/** The kiosk aggregator image resolveEntityImage reads. */
const withPhoto = <T extends object>(entity: T) => ({
  ...entity,
  aggregator_image: [{ aggreagtorName: "kiosk", png: PHOTO }],
});

const wrap = (node: ReactNode) =>
  render(
    <Provider store={store}>
      <MemoryRouter>{node}</MemoryRouter>
    </Provider>,
  );
const bellsIn = (root: HTMLElement) => root.querySelectorAll('[data-testid="no-image-bell"]');

afterEach(() => {
  store.dispatch({ type: "RESET_STATE" });
});

describe("NoImageBell", () => {
  it("is decorative: aria-hidden, the box it is given, the masked bell filling it", () => {
    render(<NoImageBell className="h-[172px] w-full" />);
    const box = screen.getByTestId("no-image-bell");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box).toHaveClass("block", "h-[172px]", "w-full");
    expect(box.firstElementChild).toHaveClass("tb-no-image-bell", "block", "h-full", "w-full");
    expect(box).toHaveTextContent("");
  });

  it("fills its parent by default", () => {
    render(<NoImageBell />);
    expect(screen.getByTestId("no-image-bell")).toHaveClass("h-full", "w-full");
  });
});

describe("every image surface: the bell without a photo, never with one", () => {
  const ITEM = { id: "latte", name: "Latte", price: 9 };

  it("the menu card: the bell takes the 172 px photo band", () => {
    wrap(<MenuItemCard entity={ITEM} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />);
    const card = screen.getByTestId("item-latte");
    const bell = within(card).getByTestId("no-image-bell");
    expect(bell).toHaveClass("h-[172px]", "min-h-0", "w-full");
    expect(card.querySelectorAll("img")).toHaveLength(1); // the "+" only
  });

  it("the menu card with a photo: the photo, no bell", () => {
    wrap(<MenuItemCard entity={withPhoto(ITEM)} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />);
    const card = screen.getByTestId("item-latte");
    expect(bellsIn(card)).toHaveLength(0);
    expect(card.querySelector(`img[src="${PHOTO}"]`)).not.toBeNull();
  });

  it("an unavailable imageless card dims its bell with the rest of the card", () => {
    wrap(<MenuItemCard entity={{ ...ITEM, outOfStock: true }} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />);
    expect(screen.getByTestId("no-image-bell")).toHaveClass("opacity-40");
  });

  it("Select a Size: the arch tile's photo box and every tile's", () => {
    const sized = {
      id: "cold-press",
      name: "Arabic Cold Press",
      variants: [
        { id: "v-sm", name: "SM", price: 1, isActive: true },
        { id: "v-md", name: "MD", price: 1.5, isActive: true },
        { id: "v-lg", name: "LG", price: 2, isActive: true },
      ],
    };
    wrap(<SelectSizeModal entity={sized} onClose={vi.fn()} onContinue={vi.fn()} />);

    const arch = within(screen.getByTestId("size-v-sm")).getByTestId("no-image-bell");
    expect(arch).toHaveClass("absolute", "left-[36px]", "top-[193px]", "h-[232px]", "w-[445px]");
    for (const id of ["v-md", "v-lg"]) {
      const tile = screen.getByTestId(`size-${id}`);
      expect(bellsIn(tile)).toHaveLength(1);
      expect(within(tile).getByTestId("no-image-bell").parentElement).toHaveClass("h-[108px]", "w-[206px]");
    }
  });

  it("Select a Size with photos: none", () => {
    const sized = {
      id: "noodles",
      name: "Noodles",
      variants: [
        withPhoto({ id: "v-q", name: "Quarter", price: 5, isActive: true }),
        withPhoto({ id: "v-h", name: "Half", price: 10, isActive: true }),
      ],
    };
    wrap(<SelectSizeModal entity={sized} onClose={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.queryAllByTestId("no-image-bell")).toHaveLength(0);
    expect(screen.getByTestId("size-v-q").querySelector(`img[src="${PHOTO}"]`)).not.toBeNull();
  });

  it("the product-added tiles: the bell in the 126×71 photo box; a tile with a photo shows it", () => {
    const plain = { id: "r-plain", name: "Americano", price: 0.5 };
    const pictured = withPhoto({ id: "r-photo", name: "Latte", price: 9 });
    store.dispatch(setEntityMap({ entityMap: { [plain.id]: plain, [pictured.id]: pictured } }));
    wrap(<ProductAddedModal onQuickAdd={vi.fn()} />);
    act(() => {
      store.dispatch(mutateAddToCartModal({ isOpen: true, item: { id: "added", recommendedItems: [plain.id, pictured.id] } }));
    });

    const bell = within(screen.getByTestId("added-rec-r-plain")).getByTestId("no-image-bell");
    expect(bell.parentElement).toHaveClass("h-[71px]", "w-[126px]");
    expect(bellsIn(screen.getByTestId("added-rec-r-photo"))).toHaveLength(0);
  });

  it.each([
    ["the bag rail", false],
    ["the PDP rail", true],
  ])("a suggestion card on %s: the bell in its photo band; never over a photo", (_label, imageTop) => {
    const card = (entity: Record<string, unknown>, testId: string) => (
      <ForYouCard
        entity={entity as any}
        title="Americano"
        price={0.5}
        currency="£"
        quantity={0}
        addLabel="Add"
        customizeLabel="Customize"
        testId={testId}
        onAdd={vi.fn()}
        imageTop={imageTop}
      />
    );
    render(
      <>
        {card({ id: "a", name: "Americano", price: 0.5 }, "plain")}
        {card(withPhoto({ id: "b", name: "Latte", price: 9 }), "photo")}
      </>,
    );
    expect(bellsIn(screen.getByTestId("plain"))).toHaveLength(1);
    expect(bellsIn(screen.getByTestId("photo"))).toHaveLength(0);
  });

  it("a bag row: the bell on the 152 px grey plate; a row with a photo shows it", () => {
    const row = {
      id: "latte",
      itemId: "latte-1",
      name: "Latte",
      quantity: 1,
      type: "ITEM",
      price: 9,
      total_price: 9,
      customizations: {},
    };
    wrap(
      <>
        <BagItemRow row={row} currency="£" onEdit={vi.fn()} onRequestRemove={vi.fn()} />
        <BagItemRow row={withPhoto({ ...row, itemId: "latte-2" })} currency="£" onEdit={vi.fn()} onRequestRemove={vi.fn()} />
      </>,
    );
    const plate = within(screen.getByTestId("bag-row-latte-1")).getByTestId("no-image-bell");
    expect(plate).toHaveClass("h-[152px]", "w-[152px]", "rounded-[8px]", "bg-tb-grey-6");
    expect(bellsIn(screen.getByTestId("bag-row-latte-2"))).toHaveLength(0);
  });

  it("the PDP option card and row: the bell in the photo box; never over a photo", () => {
    render(
      <>
        <OptionCard testId="card-plain" image={null} name="Crust" />
        <OptionCard testId="card-photo" image={PHOTO} name="Crust" />
        <OptionRow testId="row-plain" image={null} name="Sauce" qty={0} onDecrease={vi.fn()} onIncrease={vi.fn()} decreaseLabel="-" increaseLabel="+" />
        <OptionRow testId="row-photo" image={PHOTO} name="Sauce" qty={0} onDecrease={vi.fn()} onIncrease={vi.fn()} decreaseLabel="-" increaseLabel="+" />
      </>,
    );
    expect(within(screen.getByTestId("card-plain")).getByTestId("no-image-bell").parentElement).toHaveClass("h-[172px]");
    expect(within(screen.getByTestId("row-plain")).getByTestId("no-image-bell").parentElement).toHaveClass("h-[152px]", "w-[152px]");
    expect(bellsIn(screen.getByTestId("card-photo"))).toHaveLength(0);
    expect(bellsIn(screen.getByTestId("row-photo"))).toHaveLength(0);
  });
});
