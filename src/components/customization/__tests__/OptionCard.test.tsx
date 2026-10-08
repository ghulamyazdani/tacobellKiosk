import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import OptionCard, { Counter, CtaBar, formatOptionMeta, GroupHeader, OptionRow } from "../OptionCard";
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
