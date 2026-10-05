/* eslint-disable @typescript-eslint/no-explicit-any --
 * Menu entities and cart rows flow through untyped from the legacy menu
 * converters, matching the components under test. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { store } from "../../../redux/app/store";
import MenuItemCard from "../MenuItemCard";
import BagItemRow from "../../cart/BagItemRow";
import "../../../i18n";

/**
 * REGRESSION PIN — the reported bug.
 *
 * Cards used to render `entity.image_url`, which on a real deployment is the
 * generic grey S3 photo glyph for 85 of the 122 reference-menu entities. The
 * image the kiosk is meant to show lives in `aggregator_image[]` under the
 * `"kiosk"` entry (payload spells the key `aggreagtorName`, sic). Every
 * surface must resolve through `resolveEntityImage`, so an entity whose
 * `image_url` IS the placeholder must still render its kiosk asset — and the
 * placeholder URL must never reach a `src`.
 */
const PLACEHOLDER =
  "https://itemsposistnet.s3.ap-south-1.amazonaws.com/common_image/image_jpg.jpeg";
const KIOSK_PNG = "https://cdn.example.com/kiosk/crunchwrap-supreme.png";

/** Menu entity in the shape the bug was reported against. */
const ENTITY = {
  id: "crunchwrap",
  name: "Crunchwrap Supreme",
  price: "5.99",
  calorieCount: 530,
  image_url: PLACEHOLDER,
  aggregator_image: [
    { aggreagtorName: "Jahez", png: "https://cdn.example.com/jahez/crunchwrap.png" },
    { aggreagtorName: "kiosk", png: KIOSK_PNG },
  ],
};

/** The cart row is the entity spread into a row, so it carries the same feed. */
const ROW = {
  ...ENTITY,
  itemId: "cw-1",
  uniqueItemId: "cw-1-u",
  quantity: 1,
  type: "ITEM",
  price: 5.99,
  total_price: 5.99,
  customizations: {},
  baseItem: { id: "crunchwrap", name: "Crunchwrap Supreme", price: 5.99 },
};

/** Every `src` rendered inside a surface, in DOM order. */
const srcsIn = (root: HTMLElement): (string | null)[] =>
  Array.from(root.querySelectorAll("img")).map((img) => img.getAttribute("src"));

describe("entity image source (regression pin: no S3 placeholder on any card)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  describe("MenuItemCard — the surface the bug was reported on", () => {
    it("grid card renders the kiosk aggregator image, never the placeholder image_url", () => {
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={["/menu"]}>
            <MenuItemCard
              entity={ENTITY}
              currency="£"
              onOpen={vi.fn()}
              onQuickAdd={vi.fn()}
            />
          </MemoryRouter>
        </Provider>
      );
      const srcs = srcsIn(screen.getByTestId("item-crunchwrap"));
      expect(srcs).toContain(KIOSK_PNG);
      expect(srcs).not.toContain(PLACEHOLDER);
    });

    it("hero (large) card renders the kiosk aggregator image, never the placeholder image_url", () => {
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={["/menu"]}>
            <MenuItemCard
              entity={ENTITY}
              currency="£"
              large
              onOpen={vi.fn()}
              onQuickAdd={vi.fn()}
            />
          </MemoryRouter>
        </Provider>
      );
      const srcs = srcsIn(screen.getByTestId("item-crunchwrap"));
      expect(srcs).toContain(KIOSK_PNG);
      expect(srcs).not.toContain(PLACEHOLDER);
    });

    it("renders no entity <img> at all when the kiosk asset is itself the placeholder", () => {
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={["/menu"]}>
            <MenuItemCard
              entity={{
                ...ENTITY,
                aggregator_image: [{ aggreagtorName: "kiosk", png: PLACEHOLDER }],
              }}
              currency="£"
              onOpen={vi.fn()}
              onQuickAdd={vi.fn()}
            />
          </MemoryRouter>
        </Provider>
      );
      // The quick-add plus icon is a local SVG asset and still renders; the
      // placeholder must simply be absent rather than drawn as a grey glyph.
      expect(srcsIn(screen.getByTestId("item-crunchwrap"))).not.toContain(PLACEHOLDER);
    });
  });

  describe("BagItemRow — the cart half of the same sweep", () => {
    it("row thumb renders the kiosk aggregator image, never the placeholder image_url", () => {
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={["/cart"]}>
            <BagItemRow
              row={ROW as any}
              currency="£"
              onEdit={vi.fn()}
              onRequestRemove={vi.fn()}
            />
          </MemoryRouter>
        </Provider>
      );
      const srcs = srcsIn(screen.getByTestId("bag-row-cw-1"));
      expect(srcs).toContain(KIOSK_PNG);
      expect(srcs).not.toContain(PLACEHOLDER);
    });

    it("falls back to the grey thumb spacer when the kiosk asset is the placeholder", () => {
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={["/cart"]}>
            <BagItemRow
              row={
                {
                  ...ROW,
                  aggregator_image: [{ aggreagtorName: "kiosk", jpg: PLACEHOLDER }],
                } as any
              }
              currency="£"
              onEdit={vi.fn()}
              onRequestRemove={vi.fn()}
            />
          </MemoryRouter>
        </Provider>
      );
      expect(srcsIn(screen.getByTestId("bag-row-cw-1"))).not.toContain(PLACEHOLDER);
    });
  });
});
