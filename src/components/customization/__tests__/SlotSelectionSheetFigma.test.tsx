import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import SlotSelectionSheet from "../SlotSelectionSheet";
import "../../../i18n";

/*
  Item 23 (lane bag-pdp): SlotSelectionSheet restyled to Figma 1:2814 —
  rounded-t 60, 152 px thumbs, a 36 px radio with the exported check, a 96 px
  SAVE with its shadow, the 80 % purple skrim — with every testid, the SAVE
  lock and the ADA cap kept (SlotSelectionSheet.test.tsx pins the behaviour).
*/

const GROUP = { _id: "pack1_3_combo", name: "Side", min: 1, max: 1 };
const COLA = { id: "opt-cola", name: "Cola", price: 0, calorieCount: 170, image_url: "https://img.e2e.test/cola.png" };
const FRIES = { id: "opt-fries", name: "Loaded Fries", price: 0.75, calorieCount: 360, image_url: "" };

const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

const renderSheet = (overrides: Partial<Parameters<typeof SlotSelectionSheet>[0]> = {}) =>
  render(
    <SlotSelectionSheet
      open
      group={GROUP}
      options={[COLA, FRIES]}
      currency="£"
      canCustomize={(item: { id: string }) => item.id === "opt-cola"}
      onSave={vi.fn()}
      onCustomize={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
    { wrapper },
  );

/** The row card of an option (its full-row pick button is the card's last child). */
const card = (id: string) => screen.getByTestId(`slot-option-${id}`).parentElement as HTMLElement;
/** The 36 px radio of a row: the span right before the pick button. */
const radio = (id: string) => screen.getByTestId(`slot-option-${id}`).previousElementSibling as HTMLElement;

describe("SlotSelectionSheet — Figma 1:2814 structure (item 23)", () => {
  it("keeps every testid: sheet, close, save, option and customize", () => {
    renderSheet();
    for (const id of [
      "slot-sheet",
      "slot-sheet-close",
      "slot-sheet-save",
      "slot-option-opt-cola",
      "slot-option-opt-fries",
      "slot-customize-opt-cola",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("the sheet: rounded-t 60, pt 54 / px 24 / pb 24, 75 px gaps, the ADA cap; an 80 % purple skrim", () => {
    renderSheet();
    const save = screen.getByTestId("slot-sheet-save");
    const sheet = save.parentElement as HTMLElement;
    expect(sheet).toHaveClass(
      "rounded-t-[60px]",
      "pt-[54px]",
      "px-[24px]",
      "pb-[24px]",
      "gap-[75px]",
      "max-h-[min(1500px,calc(100%_-_96px))]",
    );
    const skrim = screen.getByTestId("slot-sheet").firstElementChild?.nextElementSibling;
    expect(skrim).toHaveClass("bg-tb-purple/80");
    expect(screen.getByRole("heading", { level: 2 })).toHaveClass("text-tb-purple", "text-[32px]");
    expect(screen.getByTestId("slot-sheet-close")).toHaveClass("right-[44px]", "top-[44px]", "h-[48px]", "w-[48px]");
  });

  it("rows: a 152 px grey thumb with a contained 130 px image; Md 32/36 name, Rg 24/24 meta; a divider on top", () => {
    renderSheet();
    const cola = card("opt-cola");
    expect(cola).toHaveClass("border-t", "border-tb-grey-4", "pt-[23px]");
    const thumb = cola.firstElementChild as HTMLElement;
    expect(thumb).toHaveClass("h-[152px]", "w-[152px]", "bg-tb-grey-6", "rounded-[8px]");
    expect(thumb.querySelector("img")).toHaveClass("h-[130px]", "w-[130px]", "object-contain");
    expect(screen.getByText("Cola")).toHaveClass("text-[32px]", "leading-[36px]", "font-medium");
    expect(screen.getByText("+£0.75 | 360 Cal")).toHaveClass("text-[24px]", "leading-[24px]", "text-tb-ink-purple");
    // An imageless row keeps its thumb, with no placeholder image.
    expect((card("opt-fries").firstElementChild as HTMLElement).querySelector("img")).toBeNull();
  });

  it("radio: 36 px — a 1 px purple ring, or a purple fill with the exported radio-check at 24 px", () => {
    renderSheet();
    expect(radio("opt-cola")).toHaveClass("h-[36px]", "w-[36px]", "rounded-full", "border", "border-tb-purple");
    expect(radio("opt-cola").querySelector("img")).toBeNull();

    fireEvent.click(screen.getByTestId("slot-option-opt-cola"));
    const picked = radio("opt-cola");
    expect(picked).toHaveClass("h-[36px]", "w-[36px]", "bg-tb-purple");
    expect(picked).not.toHaveClass("border");
    const check = picked.querySelector("img");
    expect(check).toHaveClass("h-[24px]", "w-[24px]");
    expect(check).toHaveAttribute("alt", "");
    expect(check?.getAttribute("src")).toMatch(/radio-check/);
    expect(radio("opt-fries").querySelector("img")).toBeNull();
  });

  it("SAVE: 96 px (py 32 + leading 32), 24 px display type; the shadow only while live — locked it is grey", () => {
    renderSheet();
    const save = screen.getByTestId("slot-sheet-save");
    expect(save).toHaveClass("py-[32px]", "text-[24px]", "leading-[32px]", "rounded-[8px]", "w-full", "tb-display");
    expect(save).toBeDisabled();
    expect(save).toHaveClass("bg-tb-grey-4");
    expect(save.className).not.toContain("shadow-");

    fireEvent.click(screen.getByTestId("slot-option-opt-fries"));
    expect(save).toBeEnabled();
    expect(save).toHaveClass("bg-tb-purple", "shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)]");
  });

  it("touch targets ≥ 44 px: the pick rows, the Customize link and the X", () => {
    renderSheet();
    expect(screen.getByTestId("slot-option-opt-cola")).toHaveClass("min-h-[44px]", "absolute", "inset-0");
    expect(screen.getByTestId("slot-customize-opt-cola")).toHaveClass("min-h-[44px]", "min-w-[44px]");
    expect(screen.getByTestId("slot-sheet-close")).toHaveClass("min-h-[44px]", "min-w-[44px]");
  });
});
