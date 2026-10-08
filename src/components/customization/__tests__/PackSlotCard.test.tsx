import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import PackSlotCard from "../PackSlotCard";
import "../../../i18n";

const GROUP = {
  _id: "pack1_2_combo",
  name: "Drink",
  min: 1,
  max: 1,
};

const PREVIEW = {
  id: "d-cola",
  name: "Cola",
  price: 0,
  calorieCount: 170,
  image_url: "",
};

// useLocalized (post-P9 item 28) reads the display language from the store.
const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

const renderCard = (
  overrides: Partial<Parameters<typeof PackSlotCard>[0]> = {}
) => {
  const onOpen = vi.fn();
  render(
    <PackSlotCard
      group={GROUP}
      selection={[]}
      previewItem={PREVIEW}
      currency="£"
      onOpen={onOpen}
      {...overrides}
    />,
    { wrapper }
  );
  return { onOpen };
};

describe("PackSlotCard (Figma 1:4641 — pack slot grid card)", () => {
  // Item 42 (1:2930): an empty CHOICE slot shows the slot's own name over its
  // first option's photo, an empty radio and SELECT {group} — no meta.
  it("empty slot: the slot's name, an empty radio + SELECT {group} CTA", () => {
    renderCard();
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card).toHaveTextContent("Drink"); // the slot (group) name
    expect(card).not.toHaveTextContent("Cola");
    expect(card).not.toHaveTextContent("170 Cal");
    expect(card).toHaveTextContent("Select Drink"); // pack.selectGroup
    expect(card).not.toHaveTextContent("Swap");
    // empty ring — no ✓ check mark rendered
    expect(card.querySelector('img[src*="radio-check"]')).toBeNull();
  });

  it("empty slot without a preview image or item: the slot name, an empty photo box", () => {
    renderCard({ previewItem: undefined });
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card).toHaveTextContent("Drink");
    expect(card).toHaveTextContent("Select Drink");
    expect(card.querySelector("img")).toBeNull(); // imageless: nothing, not a placeholder
  });

  it("selected slot: pick's name, ✓ badge and SWAP CTA", () => {
    renderCard({
      selection: [{ id: "d-pepsi", name: "Pepsi", price: 0, calorieCount: 150 }],
    });
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card).toHaveTextContent("Pepsi");
    expect(card).toHaveTextContent("Swap"); // pack.swap
    expect(card).not.toHaveTextContent("Select Drink");
    expect(card.querySelector('img[src*="radio-check"]')).not.toBeNull(); // filled ✓ badge
  });

  it("priced pick shows the Figma meta: +currency price | calories", () => {
    renderCard({
      selection: [
        { id: "d-large", name: "Large Cola", price: 0.75, calorieCount: 360 },
      ],
    });
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card).toHaveTextContent("+£0.75 | 360 Cal");
  });

  it("errored slot swaps the border for the red error ring", () => {
    renderCard({ errored: true });
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card.className).toContain("ring-red-500");
  });

  it("not-errored slot has no red ring", () => {
    renderCard();
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card.className).not.toContain("ring-red-500");
  });

  it("clicking the card fires onOpen", async () => {
    const { onOpen } = renderCard();
    await userEvent.click(screen.getByTestId("pack-slot-open-pack1_2_combo"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

/*
  Lane figma-polish item 42 (1:2930): a one-option slot with its pick is an
  INCLUDED item — FIXED: no radio, not tappable, the pick's name / meta, and
  CUSTOMIZE only when the pick can be customized (the PDP passes onCustomize
  only then). A CHOICE slot (several options, or an EMPTY one-option slot)
  keeps the radio, the overlay (pack-slot-open-*) and its CTA
  (pack-slot-cta-*), both opening the slot sheet.
*/
describe("PackSlotCard — FIXED vs CHOICE (item 42)", () => {
  const FRIES = { id: "fries", name: "Large Fries", price: 0.5, calorieCount: 360, image_url: "" };
  const SIDES = { _id: "pack1_3_combo", name: "Sides", min: 1, max: 1 };
  const radio = (card: HTMLElement) => card.querySelector("span[aria-hidden='true'].rounded-full");

  const renderSlot = (overrides: Partial<Parameters<typeof PackSlotCard>[0]> = {}) => {
    const onOpen = vi.fn();
    const onCustomize = vi.fn();
    render(
      <PackSlotCard
        group={SIDES}
        selection={[{ ...FRIES, quantity: 1 }]}
        previewItem={FRIES}
        currency="£"
        fixed
        onOpen={onOpen}
        {...overrides}
      />,
      { wrapper }
    );
    return { onOpen, onCustomize, card: screen.getByTestId("pack-slot-pack1_3_combo") };
  };

  it("FIXED, not customizable: the pick's name and meta, no radio, nothing tappable, no CTA", () => {
    const { card } = renderSlot();

    expect(card.tagName).toBe("DIV");
    expect(card).toHaveTextContent("Large Fries");
    expect(card).toHaveTextContent("+£0.50 | 360 Cal");
    expect(card).not.toHaveTextContent("Sides");
    expect(radio(card)).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByTestId("pack-slot-open-pack1_3_combo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pack-slot-cta-pack1_3_combo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pack-slot-customize-pack1_3_combo")).not.toBeInTheDocument();
  });

  it("FIXED and customizable: ONE button — pack-slot-customize-* (t('pack.customize')) — calling onCustomize, never onOpen", async () => {
    const onCustomize = vi.fn();
    const { onOpen, card } = renderSlot({ onCustomize });
    const customize = screen.getByTestId("pack-slot-customize-pack1_3_combo");

    expect(screen.getAllByRole("button")).toEqual([customize]);
    expect(customize).toHaveTextContent("Customize");
    expect(card).toContainElement(customize);
    expect(radio(card)).toBeNull();

    await userEvent.click(customize);
    expect(onCustomize).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("an EMPTY one-option slot (fixed, no pick) is a CHOICE slot: radio off, the slot name, SELECT — and no CUSTOMIZE", async () => {
    const onCustomize = vi.fn();
    const { onOpen, card } = renderSlot({ selection: [], onCustomize });

    expect(radio(card)).not.toBeNull();
    expect(card).toHaveTextContent("Sides");
    expect(screen.getByTestId("pack-slot-cta-pack1_3_combo")).toHaveTextContent("Select Sides");
    expect(screen.queryByTestId("pack-slot-customize-pack1_3_combo")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("pack-slot-open-pack1_3_combo"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onCustomize).not.toHaveBeenCalled();
  });

  it("CHOICE, picked: the radio check, SWAP on pack-slot-cta-*; the CTA and the overlay (LAST, named SWAP) both open the sheet", async () => {
    const { onOpen, card } = renderSlot({ fixed: false });
    const cta = screen.getByTestId("pack-slot-cta-pack1_3_combo");
    const overlay = screen.getByTestId("pack-slot-open-pack1_3_combo");

    expect(radio(card)?.querySelector("img")?.getAttribute("src")).toContain("radio-check");
    expect(cta).toHaveTextContent("Swap");
    expect(overlay).toHaveAccessibleName("Swap");
    expect(card.lastElementChild).toBe(overlay);

    await userEvent.click(cta);
    await userEvent.click(overlay);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
