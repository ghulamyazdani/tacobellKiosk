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

  it("blocks input past maxLength but still allows backspace", async () => {
    const onChange = vi.fn();
    render(<KioskKeyboard value="abcd" onChange={onChange} maxLength={4} />);
    await userEvent.click(screen.getByRole("button", { name: "e" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /backspace/i }));
    expect(onChange).toHaveBeenCalledWith("abc");
  });
});
