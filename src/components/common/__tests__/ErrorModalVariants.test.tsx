import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorModal from "../ErrorModal";

/*
  Lane bag-pdp (I3): ErrorModal gained `icon` (false = the plain Figma Modal
  1:945 / 1:2855 — no warning mark, a 396 px card with the CTA on its bottom
  band) and `wide` (one full-width 632 × 60 primary). The DEFAULTS must render
  the base (5112a94) markup class for class, so every existing caller — the
  boot, menu-load and crash screens — stays pixel-identical.
*/

const BASE = {
  root: "absolute inset-0 z-[80]",
  scrim: "absolute inset-0 bg-tb-purple/80",
  card: "tb-modal-enter absolute left-1/2 top-1/2 flex w-[680px] flex-col items-center gap-[80px] rounded-[16px] bg-tb-surface px-[24px] pb-[24px] pt-[80px] text-center",
  copy: "flex w-[502px] flex-col items-center gap-[24px]",
  icon: "size-[179px]",
  title: "tb-display text-[32px] leading-[32px] tracking-[-1px] text-tb-purple",
  message: "text-[28px] leading-[32px] text-tb-ink-purple",
  row: "flex gap-[26px]",
  secondary:
    "tb-display h-[60px] w-[280px] whitespace-nowrap rounded-[4px] border border-tb-purple text-[18px] leading-[16px] text-tb-purple",
  primary:
    "tb-display h-[60px] w-[280px] whitespace-nowrap rounded-[4px] bg-tb-purple text-[18px] leading-[16px] text-tb-surface",
};

const renderModal = (props: Partial<Parameters<typeof ErrorModal>[0]> = {}) =>
  render(
    <ErrorModal
      testId="x"
      title="Your bag was updated"
      message="Not available for Take Out, removed: Greek Salad"
      primary={{ label: "Got it", testId: "x-primary", onClick: vi.fn() }}
      {...props}
    />,
  );

/** [tag, class] for every element, in DOM order — the render's skeleton. */
const skeleton = (root: Element) =>
  [root, ...root.querySelectorAll("*")].map((el) => [el.tagName.toLowerCase(), el.getAttribute("class") ?? ""]);

describe("ErrorModal variants (lane bag-pdp, I3)", () => {
  it("defaults: the base markup class for class (warning mark, 280 px CTA pair)", () => {
    renderModal({ secondary: { label: "Back", testId: "x-secondary", onClick: vi.fn() } });
    expect(skeleton(screen.getByTestId("x"))).toEqual([
      ["div", BASE.root],
      ["div", BASE.scrim],
      ["div", BASE.card],
      ["div", BASE.copy],
      ["img", BASE.icon],
      ["h2", BASE.title],
      ["p", BASE.message],
      ["div", BASE.row],
      ["button", BASE.secondary],
      ["button", BASE.primary],
    ]);
  });

  it("explicit icon / wide defaults are the same render as omitting them", () => {
    const omitted = renderModal();
    const html = omitted.container.innerHTML;
    omitted.unmount();
    const explicit = renderModal({ icon: true, wide: false });
    expect(explicit.container.innerHTML).toBe(html);
  });

  it("icon={false}: no warning mark; a 396 px card whose CTA sits on the bottom band", () => {
    renderModal({ icon: false });
    const dialog = screen.getByTestId("x");
    expect(dialog.querySelector("img")).toBeNull();
    const card = dialog.children[1];
    expect(card.getAttribute("class")).toBe(`${BASE.card} min-h-[396px] justify-between`);
    // Everything else is untouched.
    expect(screen.getByRole("heading", { level: 2 })).toHaveClass(...BASE.title.split(" "));
    expect(screen.getByTestId("x-primary").getAttribute("class")).toBe(BASE.primary);
  });

  it("wide: the button row and the primary span the card (632 × 60, r4)", () => {
    renderModal({ wide: true });
    const primary = screen.getByTestId("x-primary");
    expect(primary.getAttribute("class")).toBe(BASE.primary.replace("w-[280px]", "w-full"));
    expect(primary.parentElement?.getAttribute("class")).toBe("flex w-full");
    expect(screen.getByTestId("x").querySelector("img")).not.toBeNull(); // the mark is its own switch
  });

  it("icon={false} wide — the plain Modal 1:945: an alertdialog named and described by its copy, focus on the one CTA", () => {
    renderModal({ icon: false, wide: true });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Your bag was updated");
    expect(dialog).toHaveAccessibleDescription("Not available for Take Out, removed: Greek Salad");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByTestId("x-primary")).toHaveFocus();
    expect(screen.getByTestId("x-primary")).toHaveClass("w-full", "h-[60px]");
  });
});
