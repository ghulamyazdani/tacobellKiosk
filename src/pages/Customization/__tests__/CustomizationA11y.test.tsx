import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import i18n from "../../../i18n";

/*
  P9f on the PDP: the calories (§2.6) and the multi-punch stepper names go
  through i18n (EN byte-identical, never "Cal" in AR), and "Show more" is a
  44 px toggle OUTSIDE the line-clamped description — inside it, a long
  description clipped the only control that reveals the rest. Walk
  2026-10-14: the toggle renders only when the clamp cuts the text
  (useLineClamp, OfferRow's measure) — jsdom lays nothing out, so a test
  states the measure: `clamped()` (the block overflows) or `fits()`.
*/

/** A ResizeObserver that reports at once (the browser's first observation). */
class FiringResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
// setupTests installs a silent, writable (not configurable) ResizeObserver.
const silentResizeObserver = window.ResizeObserver;
/** Every element measures `scroll` tall inside a `client` box, observed at once. */
const measure = (scroll: number, client: number) => {
  window.ResizeObserver = FiringResizeObserver as unknown as typeof ResizeObserver;
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(scroll);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(client);
};
const clamped = () => measure(72, 48);
const fits = () => measure(24, 24);
afterEach(() => {
  vi.restoreAllMocks();
  window.ResizeObserver = silentResizeObserver;
});

const EXTRAS = {
  _id: "pdp_extras",
  name: "Extras",
  min: 0,
  max: 3,
  multiplePunchMin: 0,
  multiplePunchMax: 3,
  multiplePunchMaxItem: 3, // > 1 → stepper rows
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "pickles", name: "Extra Pickles", price: 0, calorieCount: 5, isActive: true },
    { id: "jalapenos", name: "Jalapenos", price: 0.6, isActive: true },
  ],
};

const DESCRIPTION = "Seasoned beef, nacho cheese sauce and crunchy shell in a warm grilled tortilla";

const BURGER = {
  id: "cheese-burger",
  name: "Cheese Burger",
  price: 8,
  calorieCount: 740,
  description: DESCRIPTION,
  modifiers: [EXTRAS._id],
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Routes>
          <Route path="/customization" element={<Customization />} />
          <Route path="/menu" element={<div>menu-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

describe("PDP copy and controls (P9f)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: { [EXTRAS._id]: EXTRAS } }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: {
          isOpen: true,
          status: "",
          type: "customizableItem",
          openType: "new",
          editCustomizationContent: {},
        },
        selectedEntity: BURGER,
      })
    );
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  // Item 42: the rows' meta is formatOptionMeta — calories only when the
  // item carries them (the old row claimed "0 Cal" for every free option).
  it("EN is unchanged: '£8.00 | 740 Cal', the free row reads '5 Cal'", () => {
    renderPdp();

    expect(screen.getByText("£8.00 | 740 Cal")).toBeInTheDocument();
    expect(screen.getByText("5 Cal")).toBeInTheDocument();
    expect(screen.getByText("+£0.60")).toBeInTheDocument();
  });

  it("AR — switched on the PDP itself — renders t('pack.cal') for the price line and the free row, never 'Cal'", async () => {
    renderPdp();
    expect(screen.getByText("£8.00 | 740 Cal")).toBeInTheDocument();

    // The PDP mounts its own LanguageSheet: the memoised price line must follow t.
    await act(async () => {
      await i18n.changeLanguage("ar");
    });

    const priceLine = screen.getByText(`£8.00 | ${i18n.t("pack.cal", { value: 740 })}`);
    const freeRow = screen.getByText(i18n.t("pack.cal", { value: 5 }));
    expect(priceLine).not.toHaveTextContent("Cal");
    expect(freeRow).not.toHaveTextContent("Cal");
  });

  it.each(["en", "ar"])("%s: the multi-punch steppers are named t('pdp.decrease'/'pdp.increase') + the item", async (lng) => {
    await act(async () => {
      await i18n.changeLanguage(lng);
    });
    renderPdp();

    const increase = screen.getByRole("button", { name: `${i18n.t("pdp.increase")} Extra Pickles` });
    const decrease = screen.getByRole("button", { name: `${i18n.t("pdp.decrease")} Extra Pickles` });
    expect(decrease.nextElementSibling).toHaveTextContent(/^0$/);

    fireEvent.click(increase);
    expect(decrease.nextElementSibling).toHaveTextContent(/^1$/);
    fireEvent.click(decrease);
    expect(decrease.nextElementSibling).toHaveTextContent(/^0$/);
  });

  it("Show more sits after the clamped description (never inside it), is ≥44 px, and toggles the label AND the clamp", () => {
    clamped();
    renderPdp();

    const description = screen.getByText(DESCRIPTION);
    const toggle = screen.getByTestId("pdp-show-more");
    expect(description.tagName).toBe("P");
    expect(description).not.toContainElement(toggle);
    expect(description.nextElementSibling).toBe(toggle);
    expect(toggle).toHaveClass("min-h-[44px]");
    expect(toggle).toHaveAccessibleName(i18n.t("pdp.showMore"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(description).toHaveClass("line-clamp-2");

    // Expanded, the block is not re-measured: the toggle stays to collapse it.
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName(i18n.t("pdp.showLess"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(description).not.toHaveClass("line-clamp-2");

    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName(i18n.t("pdp.showMore"));
    expect(description).toHaveClass("line-clamp-2");
  });

  // Walk 2026-10-14 (Noodles, "Aggregator desc noodles"): the toggle showed
  // under a one-line description and a tap changed only its own label.
  it("a description the clamp does not cut (one line) has no Show more", () => {
    fits();
    renderPdp();

    expect(screen.getByText(DESCRIPTION)).toHaveClass("line-clamp-2");
    expect(screen.queryByTestId("pdp-show-more")).not.toBeInTheDocument();
  });

  // Walk 2026-10-14: "﷼100 | 254 Cal" painted as "254 | 100﷼ Cal" — U+FDFC
  // (bidi AL) turned the digits after it Arabic and the run RTL. The symbol
  // now rides between LRMs (useCurrencySymbol → ltrCurrencySymbol).
  it("a ﷼ deployment: the price line is the symbol between LRMs, then the price, then the calories", () => {
    const LRM = String.fromCharCode(0x200e);
    const RIAL = String.fromCharCode(0xfdfc); // ﷼ — a symbol, not AR copy
    store.dispatch(setCurrency({ currency: "SAR", text: RIAL, uniDec: "65020", uniHex: "FDFC" }));
    renderPdp();

    expect(screen.getByTestId("pdp-price").textContent).toBe(`${LRM}${RIAL}${LRM}8.00 | 740 Cal`);
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent(`· ${LRM}${RIAL}${LRM}8.00`, {
      normalizeWhitespace: false,
    });
  });
});

/*
  Lane figma-polish item 42 / S4 #9 on the PDP: "Show more" is the
  CTA/Show more component (1:1687 — Exp Bd 16/24, −0.08, purple, underlined)
  and keeps its 44 px target; the Counter (1:615) buttons are named
  t('pdp.decrease' / 'pdp.increase'); every option card is named — a plain
  card by its own text, a BYO card's overlay by the item (its CTA by its
  verb), a pack slot's overlay by its CTA label.
*/
describe("PDP names and the Show more style (item 42)", () => {
  const BYO = {
    _id: "a11y_6_combo",
    name: "Snacks",
    min: 0,
    max: 2,
    multiplePunchMin: 0,
    multiplePunchMax: 2,
    multiplePunchMaxItem: 1,
    order: 1,
    isActive: true,
    constituentItems: [{ id: "churros", name: "Churros", price: 0, isActive: true }],
  };
  const SAUCE = {
    _id: "a11y_addons",
    name: "Sauce",
    min: 0,
    max: 1,
    multiplePunchMin: 0,
    multiplePunchMax: 1,
    multiplePunchMaxItem: 1,
    order: 2,
    isActive: true,
    constituentItems: [{ id: "salsa", name: "Salsa", price: 0.5, isActive: true }],
  };
  const DRINK = {
    _id: "a11y_2_combo",
    name: "Drink",
    min: 1,
    max: 1,
    multiplePunchMin: 1,
    multiplePunchMax: 1,
    multiplePunchMaxItem: 1,
    order: 3,
    isActive: true,
    constituentItems: [
      { id: "cola", name: "Cola", price: 0, isActive: true },
      { id: "lemonade", name: "Lemonade", price: 0, isActive: true },
    ],
  };

  /** A fresh tier-1 session on `entity`, its groups in the modifier map. */
  const openSession = (entity: Record<string, unknown>, groups: Array<{ _id: string }>) => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: Object.fromEntries(groups.map((group) => [group._id, group])) }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
        selectedEntity: entity,
      })
    );
  };
  const openBox = () =>
    openSession({ id: "box", name: "Snack Box", price: 6, modifiers: [BYO._id, SAUCE._id, DRINK._id] }, [BYO, SAUCE, DRINK]);

  beforeEach(() => {
    openSession(BURGER, [EXTRAS]);
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("Show more = CTA/Show more (Exp Bd 16/24, −0.08, purple, underlined), still a ≥ 44 px inline-flex target", () => {
    clamped();
    renderPdp();

    expect(screen.getByTestId("pdp-show-more")).toHaveClass(
      "tb-display",
      "font-bold",
      "normal-case",
      "text-[16px]",
      "leading-[24px]",
      "tracking-[-0.08px]",
      "text-tb-purple",
      "underline",
      "inline-flex",
      "min-h-[44px]",
      "items-center"
    );
  });

  it.each(["en", "ar"])("%s: the Counter's buttons are named t('pdp.decrease' / 'pdp.increase'); '+' counts up", async (lng) => {
    await act(async () => {
      await i18n.changeLanguage(lng);
    });
    renderPdp();

    const increase = screen.getByTestId("pdp-qty-increase");
    expect(screen.getByTestId("pdp-qty-decrease")).toHaveAccessibleName(i18n.t("pdp.decrease"));
    expect(increase).toHaveAccessibleName(i18n.t("pdp.increase"));
    expect(increase).toHaveClass("h-[64px]", "w-[64px]");
    expect(screen.getByTestId("pdp-qty")).toHaveTextContent("1");

    fireEvent.click(increase);
    expect(screen.getByTestId("pdp-qty")).toHaveTextContent("2");
  });

  it("an option card (add-on or BYO) is ONE button named by the item, its CTA the verb inside it; a slot's overlay by its CTA", () => {
    openBox();
    renderPdp();

    // Add-on: the card itself.
    const salsa = screen.getByTestId("pdp-option-salsa");
    expect(salsa.tagName).toBe("BUTTON");
    expect(salsa).toHaveAccessibleName(/Salsa/);
    expect(salsa).toHaveAttribute("aria-pressed", "false");

    // BYO (`_combo`, several picks): the same ONE button, named by the item; the CTA its verb (2026-10-09).
    const churros = screen.getByTestId("pdp-option-churros");
    expect(churros.tagName).toBe("BUTTON");
    expect(churros).toHaveAccessibleName("Churros");
    expect(churros).toContainElement(screen.getByTestId("pdp-option-cta-churros"));
    expect(screen.getByTestId("pdp-option-cta-churros")).toHaveTextContent(i18n.t("pack.choose"));

    // Pack slot (min 1 / max 1): the overlay is named by its CTA label.
    expect(screen.getByTestId(`pack-slot-open-${DRINK._id}`)).toHaveAccessibleName(
      i18n.t("pack.selectGroup", { name: "Drink" })
    );
  });
});
