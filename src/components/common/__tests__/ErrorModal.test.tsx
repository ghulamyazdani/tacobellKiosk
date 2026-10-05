import { describe, expect, it, vi } from "vitest";
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

  it("CTAs are the 280×60 Figma pair — well over the 44×44 minimum target", () => {
    renderModal();
    for (const id of ["x-retry", "x-back"]) {
      expect(screen.getByTestId(id)).toHaveClass("h-[60px]", "w-[280px]");
      expect(screen.getByTestId(id)).toHaveAttribute("type", "button");
    }
    expect(screen.getByTestId("x-retry")).toHaveTextContent("Try again");
    expect(screen.getByTestId("x-back")).toHaveTextContent("Back");
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
