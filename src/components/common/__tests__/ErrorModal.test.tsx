import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorModal from "../ErrorModal";

/*
  P9b R10 — the ONE error dialog of the recovery surfaces (Figma 1:3427
  "Icon Modal" 1:988 + Icon L 1:990 + the 1:4514 CTA pair). Pure: props in,
  DOM out — no store, router or i18n (the app ErrorBoundary renders it after
  everything above it has died), so these tests need none either.
*/

const renderModal = (
  props: Partial<Parameters<typeof ErrorModal>[0]> = {}
) => {
  const primary = { label: "Try again", testId: "x-retry", onClick: vi.fn() };
  const secondary = { label: "Back", testId: "x-back", onClick: vi.fn() };
  render(
    <ErrorModal
      testId="x-error"
      title="We couldn't load the menu"
      message="Something went wrong."
      primary={primary}
      secondary={secondary}
      {...props}
    />
  );
  return { primary, secondary };
};

describe("ErrorModal (Figma 1:988 Icon Modal + 1:4514 CTAs)", () => {
  it("is a modal alertdialog named by its title and described by its message", () => {
    renderModal();
    const dialog = screen.getByRole("alertdialog");

    expect(dialog).toHaveAttribute("data-testid", "x-error");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("We couldn't load the menu");
    expect(dialog).toHaveAccessibleDescription("Something went wrong.");
  });

  it("stacks above page overlays (z-80) — below the idle prompt and the offline overlay", () => {
    renderModal();
    expect(screen.getByRole("alertdialog")).toHaveClass("absolute", "inset-0", "z-[80]");
  });

  it("shows the Figma Icon L (1:990) warning mark, decorative (alt=\"\")", () => {
    const { container } = render(
      <ErrorModal
        testId="x-error"
        title="t"
        message="m"
        primary={{ label: "p", testId: "p", onClick: () => {} }}
      />
    );
    const icon = container.querySelector("img");
    expect(icon).toHaveAttribute("alt", "");
    // Vite inlines the small SVG: assert it is the Figma mark in #CA16AF.
    const src = decodeURIComponent(icon?.getAttribute("src") ?? "");
    expect(src).toContain("id='Icon L'");
    expect(src).toContain("#CA16AF");
  });

  it("each CTA reaches its own handler", () => {
    const { primary, secondary } = renderModal();

    fireEvent.click(screen.getByTestId("x-retry"));
    expect(primary.onClick).toHaveBeenCalledTimes(1);
    expect(secondary.onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("x-back"));
    expect(secondary.onClick).toHaveBeenCalledTimes(1);
  });

  it("the primary CTA takes focus (an alertdialog asks for a decision)", () => {
    renderModal();
    expect(screen.getByTestId("x-retry")).toHaveFocus();
  });

  // Walk 2026-10-14: a confirm's primary IS the consequential choice (YES,
  // DELETE / YES, SWITCH) — a keypad Enter on open must not confirm it.
  it("initialFocus='secondary' (a confirm): focus starts on the safe choice, never the primary", () => {
    renderModal({
      initialFocus: "secondary",
      primary: { label: "Yes, delete", testId: "x-delete", onClick: vi.fn(), danger: true },
    });
    expect(screen.getByTestId("x-back")).toHaveFocus();
    expect(screen.getByTestId("x-delete")).not.toHaveFocus();
  });

  it("initialFocus='secondary' without a secondary: the one CTA still takes focus", () => {
    renderModal({ initialFocus: "secondary", secondary: undefined });
    expect(screen.getByTestId("x-retry")).toHaveFocus();
  });

  it("CTAs are the 280×60 Figma pair — well over the 44×44 minimum target", () => {
    renderModal();
    for (const id of ["x-retry", "x-back"]) {
      expect(screen.getByTestId(id)).toHaveClass("min-h-[60px]", "w-[280px]");
      expect(screen.getByTestId(id)).toHaveAttribute("type", "button");
    }
    expect(screen.getByTestId("x-retry")).toHaveTextContent("Try again");
    expect(screen.getByTestId("x-back")).toHaveTextContent("Back");
  });

  // Walk 2026-10-14: "NO, KEEP RESTAURANTS CO." (a pipeline name — data) ran
  // past its 280 px button under YES, SWITCH. The geometry is pinned in
  // tests/e2e/orderTypeSwitch.spec.ts (LONG NAME CONFIRM, EN / AR / ADA).
  it("a label never spills out of its CTA: both wrap, grow from 60 px and break an over-long word", () => {
    renderModal();
    for (const id of ["x-retry", "x-back"]) {
      const cta = screen.getByTestId(id);
      expect(cta.className).not.toMatch(/(?:^|\s)(?:whitespace-nowrap|truncate|text-nowrap|h-\[60px\])(?:\s|$)/);
      expect(cta).toHaveClass("min-h-[60px]", "[overflow-wrap:anywhere]");
    }
  });

  it("no secondary prop → a single CTA", () => {
    renderModal({ secondary: undefined });
    expect(screen.queryByTestId("x-back")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders the note (boot countdown) only when given", () => {
    renderModal({ note: "Trying again in 10s" });
    expect(screen.getByTestId("x-error-note")).toHaveTextContent("Trying again in 10s");
  });

  it("no note prop → no note element", () => {
    renderModal();
    expect(screen.queryByTestId("x-error-note")).not.toBeInTheDocument();
  });

  // G1: the GlobalErrorHost's message IS its title (1:6288) — no body.
  it.each([
    ["omitted", undefined],
    ["empty", ""],
  ])("message %s: no body <p> and no aria-describedby — the title alone names it", (_label, message) => {
    renderModal({ message, secondary: undefined });
    const dialog = screen.getByRole("alertdialog");

    expect(dialog).toHaveAccessibleName("We couldn't load the menu");
    expect(dialog).not.toHaveAttribute("aria-describedby");
    expect(dialog.querySelector("p")).toBeNull();
    expect(document.getElementById("x-error-message")).toBeNull();
  });

  it("every existing caller still passes a message (body + aria-describedby unchanged); only GlobalErrorHost omits it", () => {
    const SRC = join(import.meta.dirname, "../../..");
    const elements = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx$/.test(file) && !/__tests__|\.test\.tsx$/.test(file))
      .flatMap((file) =>
        [...readFileSync(join(SRC, file), "utf8").matchAll(/<ErrorModal\b[\s\S]*?\/>/g)].map(
          ([element]) => ({ file, element })
        )
      );

    expect(elements.length).toBeGreaterThan(10);
    expect(
      elements.filter(({ element }) => !/\bmessage=\{/.test(element)).map(({ file }) => file)
    ).toEqual(["components/common/GlobalErrorHost.tsx"]);
  });

  it("danger (audit-fixes C4a): the primary fills tb-red; the default stays tb-purple", () => {
    renderModal();
    expect(screen.getByTestId("x-retry")).toHaveClass("bg-tb-purple");
    expect(screen.getByTestId("x-retry")).not.toHaveClass("bg-tb-red");
  });

  it("danger: true → the red primary (white on #DE1313, ≈ 5:1), still the focused 280×60 CTA", () => {
    renderModal({ primary: { label: "Yes, delete", testId: "x-delete", onClick: vi.fn(), danger: true } });
    const primary = screen.getByTestId("x-delete");
    expect(primary).toHaveClass("bg-tb-red", "text-tb-surface", "min-h-[60px]", "w-[280px]");
    expect(primary).not.toHaveClass("bg-tb-purple");
    expect(primary).toHaveFocus();
    expect(screen.getByTestId("x-back")).not.toHaveClass("bg-tb-red");
  });

  it("the skrim is inert: a tap outside the card chooses nothing", () => {
    const { primary, secondary } = renderModal();
    const skrim = screen
      .getByRole("alertdialog")
      .querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(skrim).not.toBeNull();

    fireEvent.click(skrim as HTMLElement);

    expect(primary.onClick).not.toHaveBeenCalled();
    expect(secondary.onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
