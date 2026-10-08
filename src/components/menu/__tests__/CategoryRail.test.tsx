import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CategoryRail from "../CategoryRail";

/*
  Lane figma-polish S4 #11 (D14): the rail rows pad 24 left / 12 right, so the
  179 px label box fits "CRAVINGS MENU" (174.3 px in Cm Bd 30) on one line;
  labels stay left-aligned and the rows keep their 64 px pill.
*/

const CATEGORIES = [
  { id: "cravings", name: "Cravings Menu" },
  { id: "tacos", name: "Tacos" },
];

describe("CategoryRail (Menu-Categories)", () => {
  it("rows pad pl-24 pr-12 (never the old px-24), left-aligned, 64 px tall", () => {
    render(<CategoryRail categories={CATEGORIES} selectedId="tacos" onSelect={vi.fn()} />);

    for (const { id } of CATEGORIES) {
      const row = screen.getByTestId(`rail-${id}`);
      expect(row).toHaveClass("pl-[24px]", "pr-[12px]", "text-left", "h-[64px]", "min-h-[44px]", "tb-compressed", "text-[30px]");
      expect(row).not.toHaveClass("px-[24px]");
    }
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
});
