import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import MenuItemCard, { formatMenuPriceLine } from "../MenuItemCard";
import i18n from "../../../i18n";

/*
  P9f overlay-button pattern — Rule 1 (Category Browse → Item Detail). The
  card is an inert div: the full-card button named by the item is its ONLY
  open path, and the quick-add sits above it (z-10). Deleting the overlay or
  its onClick strands every menu item, so it must fail a unit test, not only e2e.
*/

const ENTITY = { id: "cw", name: "Crunchwrap Supreme", price: "5.99", calorieCount: 740 };

// useLocalized (post-P9 item 28) reads the display language from the store.
const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

describe("MenuItemCard", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("the overlay named by the item opens it; quick-add only quick-adds", () => {
    const onOpen = vi.fn();
    const onQuickAdd = vi.fn();
    render(<MenuItemCard entity={ENTITY} currency="£" onOpen={onOpen} onQuickAdd={onQuickAdd} />, { wrapper });

    const card = screen.getByTestId("item-cw");
    const overlay = screen.getByRole("button", { name: "Crunchwrap Supreme" });
    expect(card).not.toHaveAttribute("aria-disabled");
    expect(card).toContainElement(overlay);
    expect(overlay).toHaveClass("absolute", "inset-0");

    fireEvent.click(overlay);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(ENTITY);

    const quickAdd = screen.getByTestId("quick-add-cw");
    expect(quickAdd).toHaveClass("z-10"); // paints and hit-tests above the overlay
    fireEvent.click(quickAdd);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).toHaveBeenCalledWith(ENTITY);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("no button nests inside another button (invalid HTML, axe nested-interactive)", () => {
    render(<MenuItemCard entity={ENTITY} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />, { wrapper });

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2); // the overlay and the quick-add
    for (const button of buttons) expect(button.parentElement?.closest("button")).toBeNull();
  });

  it("unavailable: aria-disabled, and neither the overlay nor the quick-add renders", () => {
    const onOpen = vi.fn();
    render(
      <MenuItemCard entity={{ ...ENTITY, outOfStock: true }} currency="£" onOpen={onOpen} onQuickAdd={vi.fn()} />,
      { wrapper }
    );

    const card = screen.getByTestId("item-cw");
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quick-add-cw")).not.toBeInTheDocument();
    fireEvent.click(card);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("calories go through t('pack.cal'): EN '740 Cal' unchanged, AR never 'Cal'", async () => {
    const { unmount } = render(
      <MenuItemCard entity={ENTITY} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />,
      { wrapper }
    );
    expect(screen.getByTestId("item-cw")).toHaveTextContent("£5.99 | 740 Cal");
    unmount();

    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(<MenuItemCard entity={ENTITY} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />, { wrapper });

    const card = screen.getByTestId("item-cw");
    expect(card).toHaveTextContent(i18n.t("pack.cal", { value: 740 }));
    expect(card).not.toHaveTextContent("Cal");
  });

  /*
    audit-fixes U1 — the diet mark leads the price line (pure CSS, no text
    node: fonts.spec reads the price <p> as /^₹\d/). Under the full-card
    overlay, so no dead tap zone.
  */
  it("U1: the price <p> is a centred flex row — the mark, then the price text", () => {
    render(
      <MenuItemCard entity={{ ...ENTITY, tags: ["non-veg"] }} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />,
      { wrapper }
    );

    const mark = screen.getByTestId("veg-mark-non-veg");
    const price = mark.parentElement as HTMLElement;
    expect(price.tagName).toBe("P");
    expect(price).toHaveClass("flex", "items-center", "gap-[8px]");
    expect(price.firstElementChild).toBe(mark);
    expect(price.textContent).toBe("£5.99 | 740 Cal");
    expect(mark).toHaveAccessibleName(i18n.t("menu.nonVeg"));
    expect(mark).toHaveClass("pointer-events-none");
  });

  it("U1: no mark for an untagged item, nor under the operator's hide_veg_non_veg", () => {
    const { unmount } = render(
      <MenuItemCard entity={ENTITY} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />,
      { wrapper }
    );
    expect(screen.queryByTestId(/^veg-mark-/)).toBeNull();
    unmount();

    store.dispatch(setKioskSettings({ hide_veg_non_veg: true }));
    render(
      <MenuItemCard entity={{ ...ENTITY, tags: ["veg"] }} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />,
      { wrapper }
    );
    expect(screen.queryByTestId(/^veg-mark-/)).toBeNull();
    expect(screen.getByTestId("item-cw")).toHaveTextContent("£5.99 | 740 Cal");
  });

  /*
    UB4 — the name clamps (grid 2 / hero 3 lines) so the photo keeps its
    Figma height; the full name stays the overlay's accessible name.
  */
  it("UB4: the name clamps at 2 lines; the overlay keeps the full name", () => {
    const long = "2 Value Rice Bowl Non Veg+1 Small Fries+1 Cinnamon Twists+2 Pepsi Zero";
    render(
      <MenuItemCard entity={{ ...ENTITY, name: long }} currency="£" onOpen={vi.fn()} onQuickAdd={vi.fn()} />,
      { wrapper }
    );

    const name = screen.getByText(long);
    expect(name.tagName).toBe("P");
    expect(name).toHaveClass("line-clamp-2");
    expect(name).not.toHaveClass("line-clamp-3");
    expect(screen.getByRole("button", { name: long })).toHaveClass("absolute", "inset-0");
  });
});

/*
  B4 / UB1 — the ONE price-line formatter, shared by the menu cards and the
  product-added tiles (client question Q7: whole units as sent).
*/
describe("formatMenuPriceLine", () => {
  const t = i18n.t.bind(i18n);

  it.each([
    [{ price: 5.59, calorieCount: 360 }, "£5.59 | 360 Cal"],
    [{ price: 5.59, calorieCount: 0 }, "£5.59"],
    [{ price: 17 }, "£17"],
    [{ price: "8", calorieCount: "360" }, "£8 | 360 Cal"],
    [{ price: 3, nutritionalInfo: { calorieCount: 120 } }, "£3 | 120 Cal"],
    [{ price: 3, calorieCount: { value: 90 } }, "£3 | 90 Cal"],
    [{ price: 3, calorieCount: { value: 0 } }, "£3"],
    [{ price: 3, calorieCount: null }, "£3"],
    [{ price: 3, calorieCount: -5 }, "£3"],
    [{}, "£"],
    [null, "£"],
  ])("%j → %s", (entity, expected) => {
    expect(formatMenuPriceLine(entity, "£", t)).toBe(expected);
  });
});
