import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setEntityMap, setMenuData, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { store } from "../redux/app/store";
import {
  setLanguages,
  setSelectedLanguage,
} from "../redux/features/multiLanguage/multiLanguage.slice";
import Menu from "../pages/Menu";
import Customization from "../pages/Customization";
import SecondLayout from "../pages/SecondLayout";
import CompleteYourMealRail from "../components/cart/CompleteYourMealRail";
import i18n from "../i18n";

/*
  Post-P9 28 — Rule 3 (state integrity): in an Arabic session names are
  resolved at RENDER only. Every real add path — the menu tap, the size fast
  lane, the PDP commit and the bag rail — writes the primary-language
  (English) names into the cart rows, their add-on lines, the selected variant
  and the Dexie mirror; no isolate mark ever reaches state, and setSelected-
  Pipeline + the PipelineSelected event keep primary_name.

  Menu data carries its own translations (`aliases`, `_extra`), and a cart row
  is the entity spread (fork parity), so the raw Arabic SOURCE fields ride
  along in a row. The Arabic-letter check therefore drops exactly those two
  keys; the isolate check runs on everything.
*/

const { dexieRows, mockCapture } = vi.hoisted(() => ({
  dexieRows: [] as unknown[],
  mockCapture: vi.fn(),
}));

/** fake-indexeddb is not installed: an in-memory cart mirror. */
vi.mock("../models/db", () => {
  const none = () => ({
    equals: () => ({
      first: () => Promise.resolve(undefined),
      toArray: () => Promise.resolve([]),
      delete: () => Promise.resolve(0),
    }),
  });
  return {
    db: {
      cartItems: {
        add: (row: unknown) => {
          dexieRows.push(structuredClone(row));
          return Promise.resolve(dexieRows.length);
        },
        update: () => Promise.resolve(1),
        put: () => Promise.resolve(1),
        where: none,
      },
      menus: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
      recommendations: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
    },
    resetDatabase: () => Promise.resolve(),
  };
});

vi.mock("../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

// The network seam of /menu and /second: a menu that loads.
vi.mock("../hooks/menuHooks/useMenuConverters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/menuHooks/useMenuConverters")>();
  return {
    default: () => ({
      ...actual.default(),
      fetchMenu: () => Promise.resolve({ categories: [{ id: "c1" }] }),
    }),
  };
});

const FSI = "⁨";
const PDI = "⁩";
const iso = (s: string) => `${FSI}${s}${PDI}`;
const ISOLATES = /[⁦-⁩]/;
/** Arabic letters or bidi isolates — the contract's [؀-ۿ⁦-⁩]. */
const ARABIC_OR_ISOLATE = /[؀-ۿ⁦-⁩]/;
const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];

const AR_FRIES = "بطاطس كبيرة";
const AR_PEPSI = "بيبسي";
const AR_LARGE = "كبير";
const AR_BURGER = "تشيز برجر";
const AR_EXTRAS = "إضافات";
const AR_PICKLES = "مخلل إضافي";
const AR_NACHOS = "ناتشوز";
const AR_DINE = "تناول في المطعم";

const AR_SESSION = { name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" };

const FRIES = { id: "fries", name: "Large Fries", price: 2.5, aliases: AR(AR_FRIES), outOfStock: false };
const PEPSI = {
  id: "pepsi",
  name: "Pepsi",
  price: 3,
  aliases: AR(AR_PEPSI),
  outOfStock: false,
  hasVariant: true,
  variants: [{ id: "pepsi-l", name: "Large", aliases: AR(AR_LARGE), price: 3, isActive: true }],
};
const EXTRAS = {
  _id: "pdp_extras",
  name: "Extras",
  aliases: AR(AR_EXTRAS),
  min: 0,
  max: 3,
  multiplePunchMin: 0,
  multiplePunchMax: 3,
  multiplePunchMaxItem: 3,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "pickles", name: "Extra Pickles", aliases: AR(AR_PICKLES), price: 0.5, isActive: true }],
};
const BURGER = {
  id: "cheese-burger",
  name: "Cheese Burger",
  aliases: AR(AR_BURGER),
  _extra: { descriptionTranslation: AR_BURGER },
  price: 8,
  modifiers: [EXTRAS._id],
};
const NACHOS = {
  id: "nachos",
  name: "Nachos",
  aliases: AR(AR_NACHOS),
  price: 4,
  isActive: true,
  isCartRecommended: true,
};
const MENU = { categories: [{ id: "c1", name: "Sides", subCategories: [{ id: "s1", name: "Sides", entities: [FRIES, PEPSI] }] }] };

type Row = {
  id: string;
  name: unknown;
  type?: string;
  selectedVariant?: { name: unknown };
  customizations?: Record<string, { id: string; name: unknown }[]>;
};
const cartRows = () => (store.getState() as unknown as { cart: { cartItems: Row[] } }).cart.cartItems;
const rowById = (id: string) => cartRows().find((row) => row.id === id);
/** Drops the menu's own translation fields, which a row carries verbatim. */
const withoutSourceTranslations = (key: string, value: unknown) =>
  key === "aliases" || key === "_extra" ? undefined : value;

const page = (path: string, element: ReactNode) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

beforeAll(() => {
  // jsdom has no Element.scrollTo; the PDP autoscroll calls it.
  Element.prototype.scrollTo = () => {};
});

beforeEach(async () => {
  store.dispatch({ type: "RESET_STATE" });
  dexieRows.length = 0;
  mockCapture.mockReset();
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setSelectedLanguage(AR_SESSION));
  await act(async () => {
    await i18n.changeLanguage("ar");
  });
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("an Arabic session writes English names everywhere (post-P9 28, Rule 3)", () => {
  it("menu tap, size fast lane, PDP commit and bag rail: English rows, add-on lines, variant and Dexie mirror", async () => {
    // 1 — the real menu tap (the card overlay, named by the Arabic alias).
    store.dispatch(setMenuData({ menu: MENU }));
    const menu = page("/menu", <Menu />);
    fireEvent.click(screen.getByRole("button", { name: iso(AR_FRIES) }));
    // 2 — the size fast lane: quick-add on a variant item → Select a Size.
    fireEvent.click(screen.getByTestId("quick-add-pepsi"));
    expect(screen.getByTestId("size-pepsi-l")).toHaveTextContent(iso(AR_LARGE), { normalizeWhitespace: false });
    fireEvent.click(screen.getByTestId("size-pepsi-l"));
    fireEvent.click(screen.getByTestId("size-continue"));
    menu.unmount();

    // 3 — the PDP commit with an add-on picked through its Arabic stepper.
    store.dispatch(setModifiersMap({ modifiersMap: { [EXTRAS._id]: EXTRAS } }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
        selectedEntity: BURGER,
      })
    );
    const pdp = page("/customization", <Customization />);
    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("pdp.increase")} ${iso(AR_PICKLES)}` }));
    fireEvent.click(screen.getByTestId("pdp-add-to-bag"));
    pdp.unmount();

    // 4 — the bag rail card (named by verb + Arabic title).
    store.dispatch(setEntityMap({ entityMap: { [NACHOS.id]: NACHOS } }));
    page("/cart", <CompleteYourMealRail />);
    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("menu.quickAdd")} ${iso(AR_NACHOS)}` }));

    // The rows: primary-language names only.
    expect(cartRows().map((row) => [row.id, row.name])).toEqual([
      ["fries", "Large Fries"],
      ["pepsi", "Pepsi"],
      ["cheese-burger", "Cheese Burger"],
      ["nachos", "Nachos"],
    ]);
    expect(rowById("pepsi")?.type).toBe("VARIANT");
    expect(rowById("pepsi")?.selectedVariant?.name).toBe("Large");
    const addOns = Object.values(rowById("cheese-burger")?.customizations ?? {}).flat();
    expect(addOns.map((line) => [line.id, line.name])).toEqual([["pickles", "Extra Pickles"]]);

    // The Dexie mirror got the same English rows.
    expect((dexieRows as Row[]).map((row) => [row.id, row.name])).toEqual([
      ["fries", "Large Fries"],
      ["pepsi", "Pepsi"],
      ["cheese-burger", "Cheese Burger"],
      ["nachos", "Nachos"],
    ]);

    // Nothing translated anywhere in that state.
    const written = { cart: (store.getState() as { cart: unknown }).cart, dexie: dexieRows };
    expect(JSON.stringify(written)).not.toMatch(ISOLATES);
    expect(JSON.stringify(written, withoutSourceTranslations)).not.toMatch(ARABIC_OR_ISOLATE);
  });

  it("selecting a pipeline on /second keeps primary_name in setSelectedPipeline and the PipelineSelected event", async () => {
    store.dispatch(
      setLanguages({
        primary_language: { name: "English", code: "en" },
        secondary_language: { name: "Arabic", code: "ar" },
      })
    );
    store.dispatch(
      setPipelines([{ _id: "p-dine", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In", secondary_name: AR_DINE }])
    );
    page("/second", <SecondLayout />);
    const card = screen.getByTestId("pipeline-p-dine");
    expect(card).toHaveTextContent(iso(AR_DINE), { normalizeWhitespace: false });

    await act(async () => {
      fireEvent.click(card);
    });

    const selected = (store.getState() as unknown as { pipeline: { selectedPipeline: Record<string, unknown> } })
      .pipeline.selectedPipeline;
    expect(selected.primary_name).toBe("Dine In");
    expect(selected.secondary_name).toBe(AR_DINE); // the raw source field, never rewritten
    expect(JSON.stringify(selected)).not.toMatch(ISOLATES);
    expect(mockCapture).toHaveBeenCalledWith(
      "pipeline_selected",
      expect.objectContaining({ pipeline_id: "p-dine", pipeline_name: "Dine In", tab_type: "dine_in" })
    );
  });
});
