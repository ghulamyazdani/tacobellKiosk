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
  it("empty slot: preview item + empty ring + SELECT {group} CTA", () => {
    renderCard();
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card).toHaveTextContent("Cola"); // preview constituent shown
    expect(card).toHaveTextContent("170 Cal"); // cal line for a free pick
    expect(card).toHaveTextContent("Select Drink"); // pack.selectGroup
    expect(card).not.toHaveTextContent("Swap");
    // empty ring — no ✓ check mark rendered
    expect(card.querySelector("svg")).toBeNull();
  });

  it("empty slot without a preview image or item falls back to the group-name placeholder", () => {
    renderCard({ previewItem: undefined });
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    // group name appears as placeholder art AND as the title line
    expect(card).toHaveTextContent("Drink");
    expect(card).toHaveTextContent("Select Drink");
    // P9f contrast: ink-purple/60 on grey-6 is 4.98:1 (/40 was 2.65:1).
    const [art] = screen.getAllByText("Drink");
    expect(art).toHaveClass("bg-tb-grey-6", "text-tb-ink-purple/60");
    expect(art).not.toHaveClass("text-tb-ink-purple/40");
  });

  it("selected slot: pick's name, ✓ badge and SWAP CTA", () => {
    renderCard({
      selection: [{ id: "d-pepsi", name: "Pepsi", price: 0, calorieCount: 150 }],
    });
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card).toHaveTextContent("Pepsi");
    expect(card).toHaveTextContent("Swap"); // pack.swap
    expect(card).not.toHaveTextContent("Select Drink");
    expect(card.querySelector("svg")).not.toBeNull(); // filled ✓ badge
  });

  it("priced pick shows +currency price instead of calories", () => {
    renderCard({
      selection: [
        { id: "d-large", name: "Large Cola", price: 0.75, calorieCount: 360 },
      ],
    });
    const card = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(card).toHaveTextContent("+£0.75");
    expect(card).not.toHaveTextContent("360 Cal");
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
