import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import MenuItemCard from "../MenuItemCard";
import i18n from "../../../i18n";

/*
  P9f overlay-button pattern — Rule 1 (Category Browse → Item Detail). The
  card is an inert div: the full-card button named by the item is its ONLY
  open path, and the quick-add sits above it (z-10). Deleting the overlay or
  its onClick strands every menu item, so it must fail a unit test, not only e2e.
*/

const ENTITY = { id: "cw", name: "Crunchwrap Supreme", price: "5.99", calorieCount: 740 };

describe.each([false, true])("MenuItemCard (large=%s)", (large) => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("the overlay named by the item opens it; quick-add only quick-adds", () => {
    const onOpen = vi.fn();
    const onQuickAdd = vi.fn();
    render(<MenuItemCard entity={ENTITY} currency="£" large={large} onOpen={onOpen} onQuickAdd={onQuickAdd} />);

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
    render(<MenuItemCard entity={ENTITY} currency="£" large={large} onOpen={vi.fn()} onQuickAdd={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2); // the overlay and the quick-add
    for (const button of buttons) expect(button.parentElement?.closest("button")).toBeNull();
  });

  it("unavailable: aria-disabled, and neither the overlay nor the quick-add renders", () => {
    const onOpen = vi.fn();
    render(
      <MenuItemCard entity={{ ...ENTITY, outOfStock: true }} currency="£" large={large} onOpen={onOpen} onQuickAdd={vi.fn()} />
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
      <MenuItemCard entity={ENTITY} currency="£" large={large} onOpen={vi.fn()} onQuickAdd={vi.fn()} />
    );
    expect(screen.getByTestId("item-cw")).toHaveTextContent("£5.99 | 740 Cal");
    unmount();

    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(<MenuItemCard entity={ENTITY} currency="£" large={large} onOpen={vi.fn()} onQuickAdd={vi.fn()} />);

    const card = screen.getByTestId("item-cw");
    expect(card).toHaveTextContent(i18n.t("pack.cal", { value: 740 }));
    expect(card).not.toHaveTextContent("Cal");
  });
});
