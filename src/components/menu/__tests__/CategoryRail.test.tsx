import { describe, expect, it, onTestFinished, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("mounts with the selected row centred in the list (its own scrollTop, at once); a later selection whose row shows (a tap) moves nothing", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      const index = /^rail-r(\d+)$/.exec(this.dataset.testid ?? "")?.[1];
      return index === undefined ? 0 : 64 * Number(index);
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(64);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(320);
    // jsdom has no Element.scrollTo.
    const original = Element.prototype.scrollTo;
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    onTestFinished(() => {
      Element.prototype.scrollTo = original;
      vi.restoreAllMocks();
    });

    const { rerender } = render(<CategoryRail categories={rows} selectedId="r9" onSelect={vi.fn()} />);
    const list = screen.getByTestId("rail-r9").parentElement as HTMLElement;

    expect(list).toHaveClass("relative");
    expect(list.scrollTop).toBe(64 * 9 - (320 - 64) / 2);

    // Rows 7–11 show in the box at 448: a tap on row 10 moves nothing.
    rerender(<CategoryRail categories={rows} selectedId="r10" onSelect={vi.fn()} />);
    expect(list.scrollTop).toBe(64 * 9 - (320 - 64) / 2);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  /*
    User 2026-10-16: with one scroll, the menu's scroll spy moves the
    selection on its own — to a row the list's box can hide. It comes to the
    middle, smoothly (scrollBehavior(): setupTests' matchMedia never
    matches reduce).
  */
  it("a later selection whose row the box hides (the menu's scroll spy) comes to the middle, smoothly", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      const index = /^rail-r(\d+)$/.exec(this.dataset.testid ?? "")?.[1];
      return index === undefined ? 0 : 64 * Number(index);
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(64);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(320);
    const original = Element.prototype.scrollTo;
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo;
    onTestFinished(() => {
      Element.prototype.scrollTo = original;
      vi.restoreAllMocks();
    });

    const { rerender } = render(<CategoryRail categories={rows} selectedId="r0" onSelect={vi.fn()} />);
    const list = screen.getByTestId("rail-r0").parentElement as HTMLElement;
    expect(list.scrollTop).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(<CategoryRail categories={rows} selectedId="r11" onSelect={vi.fn()} />);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 64 * 11 - (320 - 64) / 2, behavior: "smooth" });
  });

  /*
    User 2026-10-16 (the menu's scroll spy): the menu marks the row in view
    through spyRef, so a section crossed re-renders the rail alone. A spied
    row stands over selectedId until that changes or a row is tapped; one the
    rail no longer lists falls back to selectedId.
  */
  it("spyRef: a spied row stands over the selection until the selection changes or a row is tapped", () => {
    const spy: { current: ((id: string) => void) | null } = { current: null };
    const rows = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ];
    const onSelect = vi.fn();
    const current = () =>
      screen
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-current") === "true")
        .map((button) => button.dataset.testid);
    const { rerender } = render(<CategoryRail categories={rows} selectedId="a" onSelect={onSelect} spyRef={spy} />);
    expect(current()).toEqual(["rail-a"]);

    act(() => spy.current?.("c"));
    expect(current()).toEqual(["rail-c"]);
    // The menu's own selection changes (a tap, a filter): it wins.
    rerender(<CategoryRail categories={rows} selectedId="b" onSelect={onSelect} spyRef={spy} />);
    expect(current()).toEqual(["rail-b"]);
    // A tap on the menu's current row while another is spied shows it at once.
    act(() => spy.current?.("c"));
    expect(current()).toEqual(["rail-c"]);
    fireEvent.click(screen.getByTestId("rail-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(current()).toEqual(["rail-b"]);
    // A spied row the rail no longer lists drops.
    act(() => spy.current?.("gone"));
    expect(current()).toEqual(["rail-b"]);
  });

  /*
    The list's box can change with no remount: the ADA toggle shrinks it to
    the reach zone's ~12 rows (ReachZone keeps the tree). A selected row the
    new box hides comes to its middle; a box that shows it moves nothing.
    jsdom has no ResizeObserver: the callback is captured (setupTests'
    global is writable, not configurable — assigned and restored by hand).
  */
  it("a resize that hides the selected row (ADA's shorter list) brings it to the middle; one that shows it moves nothing", () => {
    const rows = Array.from({ length: 18 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
    let height = 1088; // the standard list: 17 rows
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      const index = /^rail-r(\d+)$/.exec(this.dataset.testid ?? "")?.[1];
      return index === undefined ? 0 : 64 * Number(index);
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(64);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => height);
    const resized: (() => void)[] = [];
    const globals = window as unknown as { ResizeObserver: unknown };
    const original = globals.ResizeObserver;
    globals.ResizeObserver = class {
      constructor(callback: () => void) {
        resized.push(callback);
      }
      observe() {}
      disconnect() {}
    };
    onTestFinished(() => {
      globals.ResizeObserver = original;
      vi.restoreAllMocks();
    });

    render(<CategoryRail categories={rows} selectedId="r15" onSelect={vi.fn()} />);
    const list = screen.getByTestId("rail-r15").parentElement as HTMLElement;
    // The standard view: row 15 tapped in a list at its top.
    list.scrollTop = 0;

    height = 320; // ADA
    act(() => resized.forEach((callback) => callback()));
    expect(list.scrollTop).toBe(64 * 15 - (320 - 64) / 2);

    height = 1088; // back to the standard view: the row is still in the box
    act(() => resized.forEach((callback) => callback()));
    expect(list.scrollTop).toBe(64 * 15 - (320 - 64) / 2);
  });
});

