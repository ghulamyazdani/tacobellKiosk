import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import OptionCard, { Counter, CtaBar, formatOptionMeta, GroupHeader, optionCta, OptionRow } from "../OptionCard";
import i18n from "../../../i18n";

/*
  Lane figma-polish item 42 — the shared PDP / customize-page building blocks
  (Figma Menu-Item_Medium 1:2930 / 1:4904 / 1:5332, Cards/Item/Old 1:2936,
  Title/H7, Counter 1:615, CTA/Bottom screen 1:589). Presentational: no
  store; callers pass localized names and their own handlers.
*/

const t = i18n.t.bind(i18n) as TFunction;

describe("formatOptionMeta — '+£0.50 | 360 Cal'", () => {
  it.each([
    ["price and calories", { price: 0.5, calorieCount: 360 }, "+£0.50 | 360 Cal"],
    ["price only", { price: 1.2 }, "+£1.20"],
    ["calories only (a free option)", { price: 0, calorieCount: 170 }, "170 Cal"],
    ["neither", { price: 0 }, ""],
    ["nutritionalInfo calories (PackSlotCard parity)", { price: 0.75, nutritionalInfo: { calorieCount: 360 } }, "+£0.75 | 360 Cal"],
    ["an object-shaped calorie count", { price: 0, calorieCount: { value: 90 } }, "90 Cal"],
    ["a string price", { price: "2" }, "+£2.00"],
    ["nothing at all", null, ""],
  ])("%s", (_label, item, expected) => {
    expect(formatOptionMeta(item, "£", t)).toBe(expected);
  });

  it("never fabricates '0 Cal' for a free option without calorie data", () => {
    expect(formatOptionMeta({ price: 0, calorieCount: 0 }, "£", t)).toBe("");
  });
});

/* User report 2026-10-09: the CTA says what the SDK engines do with the card's tap. */
describe("optionCta — the label of the card's own tap", () => {
  const two = [{}, {}];
  const group = (min: number, max: number, items: object[] = two, mp = { min, max }) => ({
    min,
    max,
    multiplePunchMin: mp.min,
    multiplePunchMax: mp.max,
    constituentItems: items,
  });

  it.each([
    ["an unpicked card", group(0, 3), false, false, "pack.choose"],
    ["a pick in a flexible group (a tap removes it)", group(0, 3), false, true, "pack.remove"],
    ["a pick in a toggle group (min 0 / max 0)", group(0, 0), false, true, "pack.remove"],
    ["an unpicked card in a swap group (a tap swaps)", group(1, 1), false, false, "pack.choose"],
    ["the pick of a swap group: none (a tap only re-selects it)", group(1, 1), false, true, null],
    ["the pick of a ONE-option 1/1 group (the engines' flexible branch: a tap removes it)", group(1, 1, [{}]), false, true, "pack.remove"],
    // Only min 1 AND max 1 swap: an optional pick-one (0/1) or a 1/3 group is flexible — a tap on the pick removes it.
    ["the pick of an optional pick-one group (0/1: flexible, a tap removes it)", group(0, 1), false, true, "pack.remove"],
    ["the pick of a 1/3 group (flexible: a tap removes it)", group(1, 3), false, true, "pack.remove"],
    ["multi-punch ON: a raw 1/1 group with multi-punch 0 / 6 is no swap", group(1, 1, two, { min: 0, max: 6 }), true, true, "pack.remove"],
    ["multi-punch ON: a raw 0/3 group with multi-punch 1 / 1 is a swap", group(0, 3, two, { min: 1, max: 1 }), true, true, null],
  ])("%s", (_label, g, amp, selected, key) => {
    expect(optionCta(g, amp, selected, t, "cta")).toEqual(key ? { label: t(key), testId: "cta" } : undefined);
  });
});

describe("OptionCard (Menu-Item_Medium)", () => {
  const radioOf = (card: HTMLElement) => card.querySelector<HTMLElement>("span[aria-hidden='true'].h-\\[36px\\]");

  it("radio 'off': the 36 px ring top-right, no check", () => {
    render(<OptionCard testId="card" image={null} name="Cola" radio="off" onSelect={vi.fn()} />);
    const radio = radioOf(screen.getByTestId("card"));

    expect(radio).toHaveClass("absolute", "right-[12px]", "top-[12px]", "h-[36px]", "w-[36px]", "rounded-full", "border", "border-tb-purple");
    expect(radio).not.toHaveClass("bg-tb-purple");
    expect(radio?.querySelector("img")).toBeNull();
  });

  it("radio 'on' (Active): the purple fill with the exported radio-check", () => {
    render(<OptionCard testId="card" image={null} name="Cola" radio="on" onSelect={vi.fn()} />);
    const radio = radioOf(screen.getByTestId("card"));

    expect(radio).toHaveClass("bg-tb-purple");
    expect(radio).not.toHaveClass("border");
    expect(radio?.querySelector("img")?.getAttribute("src")).toContain("radio-check");
  });

  it("no radio prop = no radio at all (a FIXED pack slot)", () => {
    render(<OptionCard testId="card" image={null} name="Churros" />);

    expect(radioOf(screen.getByTestId("card"))).toBeNull();
    expect(screen.getByTestId("card").tagName).toBe("DIV");
    expect(within(screen.getByTestId("card")).queryByRole("button")).toBeNull();
  });

  it("without a CTA the card is ONE button carrying the testid, named by its text, aria-pressed = its radio", () => {
    const onSelect = vi.fn();
    render(<OptionCard testId="card" image={null} name="Regular Ice" meta="10 Cal" radio="on" onSelect={onSelect} />);
    const card = screen.getByTestId("card");

    expect(card.tagName).toBe("BUTTON");
    expect(card).toHaveAccessibleName(/Regular Ice/);
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button")).toEqual([card]);
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("aria-pressed follows the radio: 'false' when off, ABSENT on a radio-less card (a plain action, not a toggle)", () => {
    const { unmount } = render(<OptionCard testId="card" image={null} name="Cola" radio="off" onSelect={vi.fn()} />);
    expect(screen.getByTestId("card")).toHaveAttribute("aria-pressed", "false");
    unmount();

    render(<OptionCard testId="card" image={null} name="Cola" onSelect={vi.fn()} />);
    expect(screen.getByTestId("card").tagName).toBe("BUTTON");
    expect(screen.getByTestId("card")).not.toHaveAttribute("aria-pressed");
  });

  it("with a CTA: the overlay-button pattern — the named overlay is LAST in the DOM, the CTA sits above it at z-10", () => {
    const onSelect = vi.fn();
    const onCta = vi.fn();
    render(
      <OptionCard
        testId="card"
        image="/fries.png"
        name="Large Fries"
        radio="off"
        cta={{ label: "Choose", onClick: onCta, testId: "card-cta" }}
        onSelect={onSelect}
        selectLabel="Large Fries"
        selectTestId="card-open"
      />
    );
    const card = screen.getByTestId("card");
    const overlay = screen.getByTestId("card-open");
    const cta = screen.getByTestId("card-cta");

    expect(card.tagName).toBe("DIV");
    expect(card).toHaveClass("relative");
    expect(card.lastElementChild).toBe(overlay);
    expect(overlay).toHaveAccessibleName("Large Fries");
    expect(overlay).toHaveClass("absolute", "inset-0");
    expect(cta).toHaveClass("relative", "z-10");

    fireEvent.click(overlay);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(cta);
    expect(onCta).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a CTA WITHOUT onClick is the label of the card's own tap: the card stays ONE button (named by selectLabel, aria-pressed), the label a styled span inside it", () => {
    const onSelect = vi.fn();
    render(
      <OptionCard
        testId="card"
        image={null}
        name="Extra Pickles"
        meta="+£1.00"
        radio="off"
        cta={{ label: "Choose", testId: "card-cta" }}
        onSelect={onSelect}
        selectLabel="Extra Pickles"
      />
    );
    const card = screen.getByTestId("card");
    const cta = screen.getByTestId("card-cta");

    expect(card.tagName).toBe("BUTTON");
    expect(card).toHaveClass("tb-select", "tb-press-hit", "relative"); // the squeeze keeps its hit area (index.css)
    expect(screen.getAllByRole("button")).toEqual([card]);
    expect(card).toHaveAccessibleName("Extra Pickles");
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card).toContainElement(cta);
    expect(cta.tagName).toBe("SPAN");
    expect(cta).toHaveTextContent("Choose");
    expect(cta).toHaveClass("min-h-[60px]", "w-full", "rounded-[4px]", "border", "border-tb-purple", "text-tb-purple");

    fireEvent.click(cta);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a card named by selectLabel is DESCRIBED by its price line and its CTA, so a screen reader hears the price (review A1); a card named by its text needs no description", () => {
    const { rerender } = render(
      <OptionCard
        testId="card"
        image={null}
        name="Extra Pickles"
        meta="+£1.00"
        radio="off"
        cta={{ label: "Choose", testId: "card-cta" }}
        onSelect={vi.fn()}
        selectLabel="Extra Pickles"
      />
    );
    expect(screen.getByTestId("card")).toHaveAccessibleName("Extra Pickles");
    expect(screen.getByTestId("card")).toHaveAccessibleDescription("+£1.00 Choose");

    // A swap group's pick: no price line, no CTA → nothing to describe.
    rerender(<OptionCard testId="card" image={null} name="Cola" radio="on" onSelect={vi.fn()} selectLabel="Cola" reserveCta />);
    expect(screen.getByTestId("card")).not.toHaveAttribute("aria-describedby");

    // Named by its text (no selectLabel): the price is already in the name.
    rerender(<OptionCard testId="card" image={null} name="Regular Ice" meta="10 Cal" radio="off" onSelect={vi.fn()} />);
    expect(screen.getByTestId("card")).toHaveAccessibleName(/Regular Ice.*10 Cal/);
    expect(screen.getByTestId("card")).not.toHaveAttribute("aria-describedby");
  });

  it("reserveCta keeps the CTA's box when there is no CTA (hidden: no text, no testid), so a swap group's pick never jumps; without it, no box", () => {
    const { rerender } = render(
      <OptionCard testId="card" image={null} name="Cola" radio="on" onSelect={vi.fn()} selectLabel="Cola" reserveCta />
    );
    const box = screen.getByTestId("card").querySelector("span.invisible");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box).toHaveClass("mt-auto", "min-h-[60px]", "w-full");
    expect(box).toBeEmptyDOMElement();
    expect(box).not.toHaveAttribute("data-testid");

    rerender(<OptionCard testId="card" image={null} name="Cola" radio="on" onSelect={vi.fn()} selectLabel="Cola" />);
    expect(screen.getByTestId("card").querySelector("span.invisible")).toBeNull();
  });

  it("the CTA is ≥ 60 px tall and WRAPS (no nowrap — a long or Arabic group name never clips); outlined purple", () => {
    render(
      <OptionCard
        testId="card"
        image={null}
        name="Double Max Burger + Nachos Burger"
        cta={{ label: "Select Sandwich And Side", onClick: vi.fn(), testId: "card-cta" }}
      />
    );
    const cta = screen.getByTestId("card-cta");

    expect(cta).toHaveClass("min-h-[60px]", "w-full", "rounded-[4px]", "border", "border-tb-purple", "text-tb-purple");
    expect(cta.className).not.toMatch(/\b(?:whitespace-nowrap|truncate|text-nowrap)\b/);
  });

  it("the card: min-h 400 (grid rows stretch), grey-6, rounded 8, p 24; the 172 px image box", () => {
    render(<OptionCard testId="card" image="/cola.png" name="Cola" />);
    const card = screen.getByTestId("card");

    expect(card).toHaveClass("min-h-[400px]", "h-full", "bg-tb-grey-6", "rounded-[8px]", "p-[24px]", "text-left");
    expect(card.querySelector("img")?.parentElement).toHaveClass("h-[172px]");
    expect(card.querySelector("img")).toHaveAttribute("src", "/cola.png");
  });

  it("errored = the red ring; otherwise none", () => {
    const { rerender } = render(<OptionCard testId="card" image={null} name="Cola" errored />);
    expect(screen.getByTestId("card")).toHaveClass("ring-4", "ring-red-500");

    rerender(<OptionCard testId="card" image={null} name="Cola" />);
    expect(screen.getByTestId("card").className).not.toContain("ring-red-500");
  });

  it("dimmed = the photo at 40 %", () => {
    render(<OptionCard testId="card" image="/cola.png" name="Cola" dimmed />);
    expect(screen.getByTestId("card").querySelector("img")).toHaveClass("opacity-40");
  });

  it("name and meta: Md 20/24 −0.5 black, then the Rg 18/20 meta line; no meta line when empty", () => {
    const { rerender } = render(<OptionCard testId="card" image={null} name="Cola" meta="+£0.50 | 360 Cal" />);
    expect(screen.getByText("Cola")).toHaveClass("text-[20px]", "font-medium", "leading-[24px]", "tracking-[-0.5px]", "text-black");
    expect(screen.getByText("+£0.50 | 360 Cal")).toHaveClass("text-[18px]", "leading-[20px]");

    rerender(<OptionCard testId="card" image={null} name="Cola" meta="" />);
    expect(screen.getByTestId("card")).toHaveTextContent(/^Cola$/);
  });
});

/*
  Lane addon-customize (Figma 1:5332 / 1:5333 / 1:5334): an option whose item
  has options of its own gets TWO real sibling buttons — CUSTOMIZE (a pick
  only) above CHOOSE / REMOVE — and a pointer-only body overlay (no name, out
  of the tab order): CHOOSE's action unpicked, CUSTOMIZE's on a pick. The
  card's own select state rides on data-selected (index.css tb-select).
*/
describe("OptionCard — the two-button card (lane addon-customize)", () => {
  const customize = (onClick?: () => void) => ({
    label: "Customize",
    ariaLabel: "Customize Large Fries",
    testId: "card-customize",
    description: "Selected",
    onClick,
  });
  const lower = (label: string, onClick = vi.fn()) => ({
    label,
    ariaLabel: `${label} Large Fries`,
    testId: "card-cta",
    onClick,
  });
  const renderCard = (props: Partial<Parameters<typeof OptionCard>[0]> = {}) =>
    render(
      <OptionCard
        testId="card"
        image={null}
        name="Large Fries"
        meta="+£3.00"
        radio="on"
        selectTestId="card-open"
        onSelect={vi.fn()}
        {...props}
      />
    );

  it("picked: the container carries the testid, tb-press-card, tb-select and data-selected; exactly CUSTOMIZE then REMOVE, each to its own handler", () => {
    const onCustomize = vi.fn();
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    renderCard({ customize: customize(onCustomize), cta: lower("Remove", onRemove), onSelect });
    const card = screen.getByTestId("card");

    expect(card.tagName).toBe("DIV");
    expect(card).toHaveClass("tb-press-card", "tb-select");
    expect(card).toHaveAttribute("data-selected", "true");
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Customize Large Fries",
      "Remove Large Fries",
    ]);
    expect(screen.getByTestId("card-customize")).toHaveAccessibleName("Customize Large Fries");
    expect(screen.getByTestId("card-customize")).toHaveAccessibleDescription("Selected +£3.00");
    expect(screen.getByTestId("card-customize")).toHaveTextContent(/^Customize$/);
    expect(screen.getByTestId("card-cta")).toHaveAccessibleDescription("+£3.00");
    expect(screen.getByTestId("card-cta")).not.toHaveAttribute("aria-pressed");

    fireEvent.click(screen.getByTestId("card-customize"));
    expect([onCustomize.mock.calls.length, onRemove.mock.calls.length, onSelect.mock.calls.length]).toEqual([1, 0, 0]);
    fireEvent.click(screen.getByTestId("card-cta"));
    expect([onCustomize.mock.calls.length, onRemove.mock.calls.length, onSelect.mock.calls.length]).toEqual([1, 1, 0]);
  });

  it("the body overlay is pointer-only: empty, LAST, aria-hidden, tabIndex −1, no name — on a pick it is CUSTOMIZE, unpicked it is onSelect", () => {
    const onCustomize = vi.fn();
    const onSelect = vi.fn();
    const { rerender } = renderCard({ customize: customize(onCustomize), cta: lower("Remove"), onSelect });
    const overlay = screen.getByTestId("card-open");

    expect(screen.getByTestId("card").lastElementChild).toBe(overlay);
    expect(overlay).toBeEmptyDOMElement();
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveAttribute("tabindex", "-1");
    expect(overlay).not.toHaveAttribute("aria-label");
    expect(screen.getAllByRole("button")).not.toContain(overlay);
    fireEvent.click(overlay);
    expect([onCustomize.mock.calls.length, onSelect.mock.calls.length]).toEqual([1, 0]);

    rerender(
      <OptionCard
        testId="card"
        image={null}
        name="Large Fries"
        meta="+£3.00"
        radio="off"
        selectTestId="card-open"
        onSelect={onSelect}
        customize={customize()}
        cta={lower("Choose")}
      />
    );
    fireEvent.click(screen.getByTestId("card-open"));
    expect([onCustomize.mock.calls.length, onSelect.mock.calls.length]).toEqual([1, 1]);
    expect(screen.getByTestId("card")).not.toHaveAttribute("data-selected");
  });

  it("unpicked (customize without onClick): exactly one button, CHOOSE — no CUSTOMIZE and no 'Selected'", () => {
    renderCard({ radio: "off", customize: customize(), cta: lower("Choose") });

    expect(screen.getAllByRole("button")).toEqual([screen.getByTestId("card-cta")]);
    expect(screen.getByTestId("card-cta")).toHaveAccessibleName("Choose Large Fries");
    expect(screen.queryByTestId("card-customize")).toBeNull();
    expect(screen.getByTestId("card")).not.toHaveTextContent("Selected");
  });

  it("a swap group's pick (no lower button): CUSTOMIZE plus the invisible reserved box", () => {
    renderCard({ customize: customize(vi.fn()) });

    expect(screen.getAllByRole("button")).toEqual([screen.getByTestId("card-customize")]);
    const box = screen.getByTestId("card").querySelector("span.invisible");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box).toHaveClass("min-h-[60px]", "w-full");
  });

  it("the two buttons sit in ONE wrapper (16 px apart), never a button inside a button", () => {
    renderCard({ customize: customize(vi.fn()), cta: lower("Remove") });
    const up = screen.getByTestId("card-customize");
    const down = screen.getByTestId("card-cta");

    expect(up.parentElement).toBe(down.parentElement);
    expect(up.parentElement).toHaveClass("mt-auto", "flex", "w-full", "flex-col", "gap-[16px]");
    expect(screen.getByTestId("card").querySelectorAll("button button")).toHaveLength(0);
  });

  it("tall: 476 / 210 instead of 400 / 134 — the one-button card and the two-button card alike", () => {
    const contentBox = (card: HTMLElement, size: number) => card.querySelector(`.min-h-\\[${size}px\\]`);
    const { unmount } = renderCard({ tall: true, customize: customize(vi.fn()), cta: lower("Remove") });
    let card = screen.getByTestId("card");
    expect(card).toHaveClass("min-h-[476px]");
    expect(card).not.toHaveClass("min-h-[400px]");
    expect(contentBox(card, 210)).not.toBeNull();
    expect(contentBox(card, 134)).toBeNull();
    unmount();

    render(<OptionCard testId="card" image={null} name="Chips" radio="off" onSelect={vi.fn()} selectLabel="Chips" tall cta={{ label: "Choose", testId: "cta" }} />);
    card = screen.getByTestId("card");
    expect(card.tagName).toBe("BUTTON");
    expect(card).toHaveClass("min-h-[476px]");
    expect(card).not.toHaveClass("min-h-[400px]");
    expect(contentBox(card, 210)).not.toBeNull();
    expect(contentBox(card, 134)).toBeNull();
  });

  it("stable DOM: picking keeps the same lower-button node (CUSTOMIZE is inserted above it)", () => {
    const { rerender } = renderCard({ radio: "off", customize: customize(), cta: lower("Choose") });
    const before = screen.getByTestId("card-cta");

    rerender(
      <OptionCard
        testId="card"
        image={null}
        name="Large Fries"
        meta="+£3.00"
        radio="on"
        selectTestId="card-open"
        onSelect={vi.fn()}
        customize={customize(vi.fn())}
        cta={lower("Remove")}
      />
    );
    expect(screen.getByTestId("card-cta")).toBe(before);
    expect(before).toHaveTextContent("Remove");
  });

  it("scope of aria-hidden: PackSlotCard's overlay card (cta.onClick, no customize) keeps a NAMED, focusable overlay and no data-selected", () => {
    render(
      <OptionCard
        testId="card"
        image={null}
        name="Large Fries"
        radio="on"
        cta={{ label: "Customize", onClick: vi.fn(), testId: "card-cta" }}
        onSelect={vi.fn()}
        selectLabel="Large Fries"
        selectTestId="card-open"
      />
    );
    const overlay = screen.getByTestId("card-open");

    expect(overlay).toHaveAccessibleName("Large Fries");
    expect(overlay).not.toHaveAttribute("aria-hidden");
    expect(overlay).not.toHaveAttribute("tabindex");
    expect(screen.getByTestId("card")).not.toHaveAttribute("data-selected");
    expect(screen.getByTestId("card")).not.toHaveClass("tb-select");
  });

  // Fixer pass (review-figma-a11y-i18n F1 / F3 / F4); the held-touch geometry is e2e E13.
  it("both foot buttons keep their whole hit area while pressed (tb-press-hit): a held press on REMOVE's edge never falls through to the overlay's CUSTOMIZE", () => {
    renderCard({ customize: customize(vi.fn()), cta: lower("Remove") });

    expect(screen.getByTestId("card-customize")).toHaveClass("tb-press-hit", "relative");
    expect(screen.getByTestId("card-cta")).toHaveClass("tb-press-hit", "relative");
  });

  it("unpicked, CUSTOMIZE's box is kept (hidden, no button): picking never moves a wrapping name or the row", () => {
    renderCard({ radio: "off", customize: customize(), cta: lower("Choose") });
    const box = screen.getByTestId("card-cta").parentElement?.firstElementChild;

    expect(box).not.toBe(screen.getByTestId("card-cta"));
    expect(box?.tagName).toBe("SPAN");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box).toHaveClass("invisible", "min-h-[60px]", "w-full");
    expect(box).toBeEmptyDOMElement();
  });

  it("'Selected' is CUSTOMIZE's description only — hidden, never read again as stray text after REMOVE", () => {
    renderCard({ customize: customize(vi.fn()), cta: lower("Remove") });

    expect(screen.getByText("Selected")).not.toBeVisible();
    expect(screen.getByTestId("card-customize")).toHaveAccessibleDescription("Selected +£3.00");
  });
});

describe("OptionRow (Cards/Item/Old) — D6: the trash glyph only at quantity 1", () => {
  const renderRow = (qty: number, onDecrease = vi.fn(), onIncrease = vi.fn()) => {
    const view = render(
      <OptionRow
        testId="row"
        image={null}
        name="Salsa"
        meta="+£0.50"
        qty={qty}
        onDecrease={onDecrease}
        onIncrease={onIncrease}
        decreaseLabel="Decrease quantity Salsa"
        increaseLabel="Increase quantity Salsa"
      />
    );
    return { ...view, onDecrease, onIncrease };
  };
  const decrease = () => screen.getByRole("button", { name: "Decrease quantity Salsa" });
  const increase = () => screen.getByRole("button", { name: "Increase quantity Salsa" });
  const glyph = () => decrease().querySelector("img")?.getAttribute("src") ?? "";

  it.each([
    [0, "qty-minus"],
    [1, "trash"],
    [2, "qty-minus"],
    [5, "qty-minus"],
  ])("qty %i → the %s glyph, the SAME onDecrease and the same name", (qty, icon) => {
    const { onDecrease } = renderRow(qty);

    expect(glyph()).toContain(icon);
    expect(glyph()).not.toContain(icon === "trash" ? "qty-minus" : "trash");
    expect(screen.getByTestId("row")).toHaveTextContent(String(qty));
    fireEvent.click(decrease());
    expect(onDecrease).toHaveBeenCalledTimes(1);
  });

  it("'+' calls onIncrease with the plus glyph", () => {
    const { onIncrease, onDecrease } = renderRow(1);

    expect(increase().querySelector("img")?.getAttribute("src")).toContain("qty-plus");
    fireEvent.click(increase());
    expect(onIncrease).toHaveBeenCalledTimes(1);
    expect(onDecrease).not.toHaveBeenCalled();
  });

  it("44 × 44 buttons inside the 188 × 68 pill; the 152 px plate; Md 28/32 name", () => {
    renderRow(1);
    const pill = decrease().parentElement as HTMLElement;

    for (const button of [decrease(), increase()]) {
      expect(button).toHaveClass("h-[44px]", "w-[44px]");
    }
    expect(pill).toHaveClass("h-[68px]", "w-[188px]", "rounded-full");
    expect(pill).toContainElement(increase());
    expect(screen.getByTestId("row").firstElementChild).toHaveClass("h-[152px]", "w-[152px]");
    expect(screen.getByText("Salsa")).toHaveClass("text-[28px]", "leading-[32px]");
  });
});

describe("GroupHeader (Title/H7)", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("the name as an h3 in Md 20/24 −0.5 black", () => {
    render(<GroupHeader name="Hot Sauces" />);

    expect(screen.getByRole("heading", { level: 3, name: "Hot Sauces" })).toHaveClass(
      "text-[20px]",
      "font-medium",
      "leading-[24px]",
      "tracking-[-0.5px]",
      "text-black"
    );
  });

  it.each([
    ["max 2", 2, "1 of 2"],
    ["max 4", 4, "1 of 4"],
  ])("'count of max' right-aligned when %s", (_label, max, text) => {
    render(<GroupHeader name="Hot Sauces" count={1} max={max} />);

    const counter = screen.getByText(text);
    expect(counter).toHaveClass("ml-auto");
  });

  it.each([
    ["max 1", 1],
    ["max 0", 0],
    ["no max", undefined],
  ])("no counter when %s (one-per-tap groups)", (_label, max) => {
    const { container } = render(<GroupHeader name="Ice" count={1} max={max} />);

    expect(container).not.toHaveTextContent(/\bof\b/);
    expect(container.querySelector(".ml-auto")).toBeNull();
  });

  it("atOne (the PDP refuses at 1: stepper rows, a non-swap card group): '1 of 1' right-aligned", () => {
    render(<GroupHeader name="Hot Sauces" count={1} max={1} atOne />);

    expect(screen.getByText("1 of 1")).toHaveClass("ml-auto");
  });

  it.each([
    ["max 0", 0],
    ["no max", undefined],
    ["NaN", Number.NaN],
  ])("atOne: still no counter when %s", (_label, max) => {
    const { container } = render(<GroupHeader name="Hot Sauces" count={2} max={max} atOne />);

    expect(container).not.toHaveTextContent(/\bof\b/);
    expect(container.querySelector(".ml-auto")).toBeNull();
  });

  it.each([
    ["max 0", 0],
    ["no max", undefined],
    ["NaN", Number.NaN],
  ])("noMax (a group that takes no pick, user decision 2026-10-14): 'count of 0' right-aligned when %s", (_label, max) => {
    render(<GroupHeader name="Test 1" max={max} noMax />);

    expect(screen.getByText("0 of 0")).toHaveClass("ml-auto");
  });

  it("a missing count reads 0", () => {
    render(<GroupHeader name="Extras" max={3} />);
    expect(screen.getByText("0 of 3")).toBeInTheDocument();
  });

  it("Required: muted by default, red + bold when errored", () => {
    const { rerender } = render(<GroupHeader name="Drink" required />);
    const marker = () => screen.getByText(i18n.t("pdp.required"));
    expect(marker()).toHaveClass("text-tb-ink-purple/60");
    expect(marker()).not.toHaveClass("text-red-600");

    rerender(<GroupHeader name="Drink" required errored />);
    expect(marker()).toHaveClass("font-bold", "text-red-600");

    rerender(<GroupHeader name="Drink" />);
    expect(screen.queryByText(i18n.t("pdp.required"))).not.toBeInTheDocument();
  });

  it("Arabic: the counter and the marker are i18n.t('pdp.groupCount' / 'pdp.required') in Arabic", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(<GroupHeader name="صلصات" count={2} max={3} required />);

    const counter = screen.getByText(i18n.t("pdp.groupCount", { count: 2, max: 3 }));
    expect(counter.textContent).toContain("من");
    expect(counter).not.toHaveTextContent("of");
    expect(screen.getByText(i18n.t("pdp.required"))).toHaveTextContent("مطلوب");
  });
});

describe("Counter (1:615) and CtaBar (1:589)", () => {
  it("Counter: three 64 px circles; testids `${id}-decrease` / `${id}` / `${id}-increase`; named buttons", () => {
    const onDecrease = vi.fn();
    const onIncrease = vi.fn();
    render(
      <Counter testId="qty" value={2} onDecrease={onDecrease} onIncrease={onIncrease} decreaseLabel="Less" increaseLabel="More" />
    );

    expect(screen.getByTestId("qty")).toHaveTextContent("2");
    for (const id of ["qty-decrease", "qty", "qty-increase"]) {
      expect(screen.getByTestId(id)).toHaveClass("h-[64px]", "w-[64px]", "rounded-full");
    }
    fireEvent.click(screen.getByRole("button", { name: "Less" }));
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onDecrease).toHaveBeenCalledTimes(1);
    expect(onIncrease).toHaveBeenCalledTimes(1);
  });

  it("Counter without onIncrease renders no '+' (the hide-plus setting)", () => {
    render(<Counter testId="qty" value={1} onDecrease={vi.fn()} decreaseLabel="Less" increaseLabel="More" />);

    expect(screen.queryByTestId("qty-increase")).not.toBeInTheDocument();
    expect(screen.getByTestId("qty-decrease")).toBeInTheDocument();
  });

  it("CtaBar: the 148 px purple bar; BACK = chevron + underlined label (≥ 168 px); the action = label + bag icon, disable-able", () => {
    const onBack = vi.fn();
    const onAction = vi.fn();
    const { rerender } = render(
      <CtaBar backTestId="back" backLabel="Back" onBack={onBack} actionTestId="go" action="Update" onAction={onAction} />
    );
    const bar = screen.getByTestId("back").parentElement as HTMLElement;

    expect(bar).toHaveClass("h-[148px]", "bg-tb-purple");
    expect(screen.getByTestId("back")).toHaveClass("min-w-[168px]");
    expect(screen.getByTestId("back").querySelector("img")?.getAttribute("src")).toContain("chevron-left");
    expect(screen.getByText("Back")).toHaveClass("underline");
    expect(screen.getByTestId("go")).toHaveTextContent("Update");
    // bag.svg is imported plain (MenuCtaBar's inlined module): a decorative 50 px data URI.
    expect(screen.getByTestId("go").querySelector("img")).toHaveClass("h-[50px]", "w-[50px]");
    expect(screen.getByTestId("go").querySelector("img")).toHaveAttribute("alt", "");
    fireEvent.click(screen.getByTestId("back"));
    fireEvent.click(screen.getByTestId("go"));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(
      <CtaBar backTestId="back" backLabel="Back" onBack={onBack} actionTestId="go" action="Update" onAction={onAction} actionDisabled />
    );
    expect(screen.getByTestId("go")).toBeDisabled();
  });
});
