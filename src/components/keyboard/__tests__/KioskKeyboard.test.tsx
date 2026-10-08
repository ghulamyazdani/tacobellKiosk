import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KioskKeyboard from "../KioskKeyboard";
import "../../../i18n";

describe("KioskKeyboard", () => {
  it("types characters and respects maxLength", async () => {
    const onChange = vi.fn();
    render(<KioskKeyboard value="abc" onChange={onChange} maxLength={4} />);
    await userEvent.click(screen.getByRole("button", { name: "d" }));
    expect(onChange).toHaveBeenCalledWith("abcd");
  });

  it("shift capitalizes a single keypress; 123 toggles the digit layer", async () => {
    const onChange = vi.fn();
    render(<KioskKeyboard value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /shift/i }));
    await userEvent.click(screen.getByRole("button", { name: "q" }));
    expect(onChange).toHaveBeenCalledWith("Q");
    // Digit layer
    await userEvent.click(screen.getByRole("button", { name: /numbers and symbols/i }));
    expect(screen.getByRole("button", { name: "7" })).toBeInTheDocument();
  });

  it("default layout (no `space`): no space key, and the bottom row keeps its exact classes (123 · GO)", () => {
    render(<KioskKeyboard value="" onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId("keyboard-space")).not.toBeInTheDocument();
    const go = screen.getByTestId("keyboard-go");
    expect(go.parentElement?.getAttribute("class")).toBe("flex w-[844px] items-center justify-between");
    expect(go.parentElement?.children).toHaveLength(2);
  });

  it("`space` (audit-fixes U3): a named space bar between 123 and GO that types one space and honours maxLength", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <KioskKeyboard value="no" onChange={onChange} onSubmit={vi.fn()} maxLength={3} space />
    );
    const space = screen.getByTestId("keyboard-space");
    expect(space).toHaveAccessibleName("Space");
    expect(space).toHaveClass("flex-1", "min-h-[44px]");
    const row = space.parentElement as HTMLElement;
    expect(row.getAttribute("class")).toBe("flex w-[844px] items-center gap-[16px]");
    expect([...row.children].map((key) => key.getAttribute("aria-label") ?? key.getAttribute("data-testid"))).toEqual([
      "Toggle numbers and symbols",
      "Space",
      "keyboard-go",
    ]);

    await userEvent.click(space);
    expect(onChange).toHaveBeenCalledWith("no ");

    onChange.mockClear();
    rerender(<KioskKeyboard value="no " onChange={onChange} maxLength={3} space />);
    await userEvent.click(screen.getByTestId("keyboard-space"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blocks input past maxLength but still allows backspace", async () => {
    const onChange = vi.fn();
    render(<KioskKeyboard value="abcd" onChange={onChange} maxLength={4} />);
    await userEvent.click(screen.getByRole("button", { name: "e" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /backspace/i }));
    expect(onChange).toHaveBeenCalledWith("abc");
  });
});
