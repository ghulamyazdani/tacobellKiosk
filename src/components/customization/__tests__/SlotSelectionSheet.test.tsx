import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SlotSelectionSheet from "../SlotSelectionSheet";
import "../../../i18n";

const GROUP = { _id: "pack1_3_combo", name: "Side", min: 1, max: 1 };

const COLA = {
  id: "opt-cola",
  name: "Cola",
  price: 0,
  calorieCount: 170,
  image_url: "",
};
const FRIES = {
  id: "opt-fries",
  name: "Loaded Fries",
  price: 0.75,
  calorieCount: 360,
  image_url: "",
};

const renderSheet = (
  overrides: Partial<Parameters<typeof SlotSelectionSheet>[0]> = {}
) => {
  const onSave = vi.fn();
  const onCustomize = vi.fn();
  const onClose = vi.fn();
  render(
    <SlotSelectionSheet
      open
      group={GROUP}
      options={[COLA, FRIES]}
      currency="£"
      canCustomize={() => false}
      onSave={onSave}
      onCustomize={onCustomize}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSave, onCustomize, onClose };
};

describe("SlotSelectionSheet (Figma 1:4761/1:4692 — SELECT sheet)", () => {
  it("renders nothing while closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByTestId("slot-sheet")).not.toBeInTheDocument();
  });

  it("shows the SELECT {group} title and partitions Included vs Upgrades by price", () => {
    renderSheet();
    const sheet = screen.getByTestId("slot-sheet");
    expect(sheet).toHaveTextContent("Select Side");
    expect(sheet).toHaveTextContent("Included");
    expect(sheet).toHaveTextContent("Upgrades");
    // free row: cal only; priced row: "+£0.75 | 360 Cal"
    const cola = screen.getByTestId("slot-option-opt-cola").parentElement;
    const fries = screen.getByTestId("slot-option-opt-fries").parentElement;
    expect(cola).toHaveTextContent("170 Cal");
    expect(cola).not.toHaveTextContent("+£");
    expect(fries).toHaveTextContent("+£0.75 | 360 Cal");
  });

  it("SAVE is locked while min > 0 and nothing is picked; a pick unlocks it and returns the item", async () => {
    const { onSave } = renderSheet();
    const save = screen.getByTestId("slot-sheet-save");
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByTestId("slot-option-opt-fries"));
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opt-fries", name: "Loaded Fries" })
    );
  });

  it("selectedId seeds the radio so SAVE works immediately", async () => {
    const { onSave } = renderSheet({ selectedId: "opt-cola" });
    const save = screen.getByTestId("slot-sheet-save");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opt-cola" })
    );
  });

  it("SAVE on an optional (min 0) group with no pick closes without onSave", async () => {
    const { onSave, onClose } = renderSheet({
      group: { ...GROUP, min: 0 },
    });
    await userEvent.click(screen.getByTestId("slot-sheet-save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Customize link renders only where canCustomize(item) and fires onCustomize without changing the pick", async () => {
    const { onSave, onCustomize } = renderSheet({
      canCustomize: (item: { id: string }) => item.id === "opt-cola",
    });
    expect(screen.getByTestId("slot-customize-opt-cola")).toBeInTheDocument();
    expect(
      screen.queryByTestId("slot-customize-opt-fries")
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("slot-customize-opt-cola"));
    expect(onCustomize).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opt-cola" })
    );
    expect(onSave).not.toHaveBeenCalled();
    // customize must not seed the radio — SAVE stays locked (min 1, no pick)
    expect(screen.getByTestId("slot-sheet-save")).toBeDisabled();
  });

  it("the X close button fires onClose", async () => {
    const { onClose } = renderSheet();
    await userEvent.click(screen.getByTestId("slot-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-opening on another group re-seeds the local pick from selectedId", async () => {
    // keyed remount: same mounted sheet, group swap → radio resets
    const onSave = vi.fn();
    const props = {
      open: true,
      options: [COLA, FRIES],
      currency: "£",
      canCustomize: () => false,
      onSave,
      onCustomize: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <SlotSelectionSheet {...props} group={GROUP} selectedId="opt-fries" />
    );
    expect(screen.getByTestId("slot-sheet-save")).toBeEnabled();
    rerender(
      <SlotSelectionSheet
        {...props}
        group={{ _id: "pack1_4_combo", name: "Dessert", min: 1, max: 1 }}
        selectedId={undefined}
      />
    );
    const sheet = screen.getByTestId("slot-sheet");
    expect(within(sheet).getByText("Select Dessert")).toBeInTheDocument();
    expect(screen.getByTestId("slot-sheet-save")).toBeDisabled();
  });

  it("ADA (P9c): capped by its containing block with the X and SAVE outside the scroller", () => {
    renderSheet();
    const close = screen.getByTestId("slot-sheet-close");

    expect(
      close.closest('[class*="max-h-[min(1500px,calc(100%_-_96px))]"]')
    ).not.toBeNull();
    expect(close.closest(".overflow-y-auto")).toBeNull();
    expect(
      screen.getByTestId("slot-sheet-save").closest(".overflow-y-auto")
    ).toBeNull();
    expect(
      screen.getByTestId("slot-option-opt-cola").closest(".overflow-y-auto")
    ).not.toBeNull();
  });
});
