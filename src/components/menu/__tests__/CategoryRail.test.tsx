import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CategoryRail from "../CategoryRail";

/*
  Lane figma-polish S4 #11 (D14): the rail rows pad 24 left / 12 right, so the
  179 px label box fits "CRAVINGS MENU" (174.3 px in Cm Bd 30) on one line;
  labels stay left-aligned and the rows keep their 64 px pill.
  rail-wrap (user report 2026-10-14): 64 px is the row's MINIMUM — a fixed
  h-[64px] cut the tenant's 3-line "NEW HERFY SUPER CATGEORY". The geometry
  (64 / 64 / 88 px, nothing outside the row) is measured in
  tests/e2e/railLongNames.spec.ts; jsdom has no layout.
*/

const CATEGORIES = [
  { id: "cravings", name: "Cravings Menu" },
  { id: "tacos", name: "Tacos" },
];

describe("CategoryRail (Menu-Categories)", () => {
  it("rows pad pl-24 pr-12 (never the old px-24), left-aligned, at least 64 px tall", () => {
    render(<CategoryRail categories={CATEGORIES} selectedId="tacos" onSelect={vi.fn()} />);

    for (const { id } of CATEGORIES) {
      const row = screen.getByTestId(`rail-${id}`);
      expect(row).toHaveClass("pl-[24px]", "pr-[12px]", "text-left", "min-h-[64px]", "tb-compressed", "text-[30px]", "leading-[24px]");
      expect(row).not.toHaveClass("px-[24px]");
    }
  });

  it("a long name grows its row: no fixed h-[64px], min 64 with 8 px insets, a long word breaks in the box", () => {
    const long = { id: "herfy", name: "NEW HERFY SUPER CATGEORY" };
    render(<CategoryRail categories={[long, ...CATEGORIES]} selectedId="herfy" onSelect={vi.fn()} />);

    const row = screen.getByTestId("rail-herfy");
    expect(row).toHaveTextContent("NEW HERFY SUPER CATGEORY");
    expect(row.className.split(/\s+/).filter((c) => /^(max-)?h-/.test(c))).toEqual([]);
    expect(row).toHaveClass("min-h-[64px]", "py-[8px]", "[overflow-wrap:anywhere]");
    // The selected pill is the row's own fill, so it grows with the row.
    expect(row).toHaveClass("bg-tb-purple-vibrant");
  });

  it("the selected row is the vibrant pill; a tap selects by id", () => {
    const onSelect = vi.fn();
    render(<CategoryRail categories={CATEGORIES} selectedId="tacos" onSelect={onSelect} />);

    expect(screen.getByTestId("rail-tacos")).toHaveClass("bg-tb-purple-vibrant", "text-tb-surface");
    expect(screen.getByTestId("rail-cravings")).toHaveClass("text-tb-purple");
    expect(screen.getByTestId("rail-cravings")).not.toHaveClass("bg-tb-purple-vibrant");

    fireEvent.click(screen.getByTestId("rail-cravings"));
    expect(onSelect).toHaveBeenCalledWith("cravings");
  });

  /*
    audit-fixes U1 — an optional slot between the bell and the list (Menu puts
    the diet chips there). Only the list scrolls; nothing renders without it.
  */
  it("renders its children between the bell and the scrolling list", () => {
    render(
      <CategoryRail categories={CATEGORIES} selectedId="tacos" onSelect={vi.fn()}>
        <div data-testid="rail-slot" />
      </CategoryRail>
    );

    const rail = screen.getByTestId("category-rail");
    const [bell, slot, list] = Array.from(rail.children);
    expect(bell.tagName).toBe("IMG");
    expect(slot).toBe(screen.getByTestId("rail-slot"));
    expect(list).toHaveClass("overflow-y-auto");
    expect(list).toContainElement(screen.getByTestId("rail-tacos"));
    expect(slot).not.toContainElement(screen.getByTestId("rail-tacos"));
  });

  it("without children: the bell, then the list — nothing in between", () => {
    render(<CategoryRail categories={CATEGORIES} selectedId="tacos" onSelect={vi.fn()} />);

    const children = Array.from(screen.getByTestId("category-rail").children);
    expect(children).toHaveLength(2);
    expect(children[0].tagName).toBe("IMG");
    expect(children[1]).toHaveClass("overflow-y-auto");
  });

  it("the list scrolls without a native scrollbar, like the menu pane (user 2026-10-14)", () => {
    render(<CategoryRail categories={CATEGORIES} selectedId="tacos" onSelect={vi.fn()} />);

    const list = screen.getByTestId("category-rail").children[1];
    expect(list).toHaveClass("overflow-y-auto", "[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden");
  });

  /*
    User 2026-10-15 (the layout settings): one at a time, the menu keeps the
    selection through the PDP, so the rail can mount with a row far down a
    long list (an ADA rail holds ~12). jsdom has no layout: the geometry is
    stubbed — 64 px rows in a 320 px list (offsetTop is measured from the
    list, which is `relative`).
  */
  it("mounts with the selected row centred in the list (its own scrollTop); a later selection never moves the list", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      const index = /^rail-r(\d+)$/.exec(this.dataset.testid ?? "")?.[1];
      return index === undefined ? 0 : 64 * Number(index);
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(64);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(320);

    const { rerender } = render(<CategoryRail categories={rows} selectedId="r9" onSelect={vi.fn()} />);
    const list = screen.getByTestId("rail-r9").parentElement as HTMLElement;

    expect(list).toHaveClass("relative");
    expect(list.scrollTop).toBe(64 * 9 - (320 - 64) / 2);

    list.scrollTop = 0;
    rerender(<CategoryRail categories={rows} selectedId="r11" onSelect={vi.fn()} />);
    expect(list.scrollTop).toBe(0);
    vi.restoreAllMocks();
  });
});

