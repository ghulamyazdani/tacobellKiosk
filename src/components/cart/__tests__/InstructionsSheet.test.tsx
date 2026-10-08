import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import InstructionsSheet from "../InstructionsSheet";
import i18n from "../../../i18n";

/*
  audit-fixes U3 — the cooking-instructions sheet (lazy, bagLazyParts):
  typed on the kiosk keyboard (its opt-in space bar), whitespace runs
  collapse, 100 characters at most with a counter, CLEAR empties, SAVE hands
  back the trimmed note, X and the scrim discard the draft. Pure: no store.
*/

const renderSheet = (initialValue = "") => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<InstructionsSheet initialValue={initialValue} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
};

const key = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const type = (text: string) =>
  [...text].forEach((char) => (char === " " ? fireEvent.click(screen.getByTestId("keyboard-space")) : key(char)));
const field = () => screen.getByTestId("instructions-input");
const counter = () => screen.getByTestId("instructions-counter");

describe("InstructionsSheet (U3)", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("a modal dialog named by its title; the field shows the placeholder, the counter 0/100", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Cooking instructions" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(field()).toHaveTextContent("e.g. No onions, extra sauce");
    // Fixer UI-2: the placeholder keeps the box's left edge in Arabic (no
    // dir="auto" until the guest types — geometry: visual-bagpdp BAG EXTRAS).
    expect(field()).not.toHaveAttribute("dir");
    expect(counter()).toHaveTextContent("0/100");
    // Fixer UI-4: the keyboard-driven field is a named, described textbox.
    expect(screen.getByRole("textbox", { name: "Cooking instructions" })).toBe(field());
    expect(field()).toHaveAccessibleDescription("0/100");
    // Its own position-neutral entrance — never tb-modal-enter (a sheet).
    expect(dialog.className).not.toContain("tb-modal-enter");
    expect(dialog.getAttribute("style")).toContain("tbInstructionsSheetEnter");
  });

  it("types on the keyboard with a space bar; runs of spaces collapse to one", () => {
    renderSheet();
    type("no  onions");
    expect(field()).toHaveTextContent(/^no onions$/);
    expect(field()).toHaveAttribute("dir", "auto");
    expect(counter()).toHaveTextContent("9/100");
  });

  it("starts from the saved note (whitespace tidied) and caps at 100 characters", () => {
    renderSheet(`extra\n\n sauce ${"x".repeat(120)}`);
    expect(field().textContent).toBe(`extra sauce ${"x".repeat(88)}`);
    expect(counter()).toHaveTextContent("100/100");
    key("a");
    expect(field().textContent).toHaveLength(100);
    expect(field().textContent?.endsWith("x")).toBe(true);
  });

  it("SAVE hands back the trimmed note; CLEAR empties the draft (SAVE then removes the note)", () => {
    const { onSave, onClose } = renderSheet(" ");
    type("no onions ");
    fireEvent.click(screen.getByTestId("instructions-save"));
    expect(onSave).toHaveBeenCalledWith("no onions");

    fireEvent.click(screen.getByTestId("instructions-clear"));
    expect(field()).toHaveTextContent("e.g. No onions, extra sauce");
    expect(counter()).toHaveTextContent("0/100");
    fireEvent.click(screen.getByTestId("instructions-save"));
    expect(onSave).toHaveBeenLastCalledWith("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("X and the scrim close WITHOUT saving (the draft is discarded)", () => {
    const { onSave, onClose } = renderSheet("extra sauce");
    type(" x");
    fireEvent.click(screen.getByTestId("instructions-close"));
    fireEvent.click(screen.getByTestId("instructions-scrim"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("instructions-close")).toHaveAccessibleName("Close");
    expect(screen.getByTestId("instructions-scrim")).toHaveAccessibleName("Close");
  });

  it("Arabic: the title, placeholder, counter, CLEAR, SAVE and the space bar read the Arabic copy", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderSheet();
    expect(screen.getByRole("dialog", { name: i18n.t("bag.instructions.title") })).toBeInTheDocument();
    expect(field()).toHaveTextContent(i18n.t("bag.instructionsSheet.placeholder"));
    expect(counter()).toHaveTextContent(i18n.t("bag.instructionsSheet.counter", { count: 0, max: 100 }));
    expect(screen.getByTestId("instructions-clear")).toHaveTextContent(i18n.t("keyboard.clear"));
    expect(screen.getByTestId("instructions-save")).toHaveTextContent(i18n.t("bag.instructionsSheet.save"));
    expect(screen.getByTestId("keyboard-space")).toHaveAccessibleName(i18n.t("keyboard.space"));
    expect(i18n.t("bag.instructionsSheet.save")).not.toBe("Save");
  });

  it("every control is a ≥ 44 px target (classes — jsdom has no layout)", () => {
    renderSheet();
    for (const testId of ["instructions-close", "instructions-clear", "instructions-save"]) {
      expect(screen.getByTestId(testId)).toHaveClass("min-h-[44px]");
    }
    expect(screen.getByTestId("instructions-close")).toHaveClass("min-w-[44px]");
    expect(screen.getByTestId("instructions-scrim")).toHaveClass("absolute", "inset-0");
  });
});
