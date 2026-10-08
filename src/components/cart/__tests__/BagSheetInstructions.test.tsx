import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartInstructions, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../BagSheet";
import "../../../i18n";

/*
  audit-fixes U3 — the bag's cooking-instructions entry (design language, no
  frame): the row after Rewards shows the note or the hint, opens the lazy
  sheet, SAVE stores the trimmed note (cart.instructions — it rides
  special_instructions on both order paths), X discards. Analytics carry
  only the note's length. The failed-chunk scrim is BagSheetChunkFail's.
*/

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: mocks.capture,
}));

const BURGER = { id: "burger", itemId: "b-1", name: "Cheese Burger", quantity: 1, type: "ITEM", price: 8, total_price: 8 };

const instructions = () => (store.getState() as unknown as { cart: { instructions: string } }).cart.instructions;

const renderBag = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );

const openSheet = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("bag-instructions-entry"));
  });
  return screen.findByTestId("instructions-sheet");
};

const typeKeys = (text: string) =>
  [...text].forEach((char) =>
    fireEvent.click(
      char === " "
        ? screen.getByTestId("keyboard-space")
        : screen.getByRole("button", { name: char }),
    ),
  );

describe("BagSheet — cooking instructions (U3)", () => {
  beforeAll(async () => {
    await import("../bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setCartItems([{ ...BURGER }]));
    mocks.capture.mockReset();
  });

  it("the entry row: the title, the hint while there is no note, a ≥ 44 px full-row button, a dir=auto leaf", () => {
    renderBag();
    const entry = screen.getByTestId("bag-instructions-entry");
    const text = screen.getByTestId("bag-instructions-text");

    expect(screen.getByText("Cooking instructions")).toBeInTheDocument();
    expect(text).toHaveTextContent("Add a note for the kitchen");
    expect(text).toHaveAttribute("dir", "auto");
    expect(text).toHaveClass("text-start", "line-clamp-2");
    // Fixer UI-2: a shrink-to-fit leaf in the full-width slot — one Arabic
    // line keeps the header's left edge (geometry: visual-bagpdp BAG EXTRAS).
    expect(text).toHaveClass("w-fit", "max-w-full");
    expect(text).not.toHaveClass("flex-1");
    expect(text.parentElement).toHaveClass("min-w-0", "flex-1");
    // Fixer UI-4: named by the header AND the hint / note, never the text alone.
    expect(entry).toHaveAccessibleName("Cooking instructions Add a note for the kitchen");
    expect(entry).toHaveClass("min-h-[44px]", "w-full");
    // After the order rows, before the bill block.
    expect(
      screen.getByTestId("bag-row-b-1").compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      entry.compareDocumentPosition(screen.getByTestId("bag-subtotal")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByTestId("instructions-sheet")).not.toBeInTheDocument();
  });

  it("a saved note shows instead of the hint (the entry's name keeps the title)", () => {
    store.dispatch(setCartInstructions("no onions please"));
    renderBag();
    expect(screen.getByTestId("bag-instructions-text")).toHaveTextContent("no onions please");
    expect(screen.getByTestId("bag-instructions-entry")).toHaveAccessibleName(
      "Cooking instructions no onions please",
    );
  });

  it("tap → AddInstructionClicked + the sheet; SAVE → the trimmed note, InstructionAdded (length only), the sheet closes", async () => {
    renderBag();
    await openSheet();
    expect(mocks.capture).toHaveBeenCalledWith("Add_instruction_clicked", { has_existing_instruction: false });

    typeKeys("no onions ");
    fireEvent.click(screen.getByTestId("instructions-save"));

    expect(instructions()).toBe("no onions");
    expect(mocks.capture).toHaveBeenCalledWith("instruction_added", { instruction_length: 9 });
    expect(screen.queryByTestId("instructions-sheet")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-instructions-text")).toHaveTextContent("no onions");
  });

  it("an existing note: the sheet starts from it (has_existing_instruction true); X discards the edit — AddInstructionDismissed, the note unchanged", async () => {
    store.dispatch(setCartInstructions("extra sauce"));
    renderBag();
    await openSheet();
    expect(mocks.capture).toHaveBeenCalledWith("Add_instruction_clicked", { has_existing_instruction: true });
    expect(screen.getByTestId("instructions-input")).toHaveTextContent("extra sauce");

    fireEvent.click(screen.getByTestId("instructions-clear"));
    fireEvent.click(screen.getByTestId("instructions-close"));

    expect(mocks.capture).toHaveBeenCalledWith("Add_instruction_dismissed", {});
    expect(instructions()).toBe("extra sauce");
    expect(screen.queryByTestId("instructions-sheet")).not.toBeInTheDocument();
    expect(mocks.capture).not.toHaveBeenCalledWith("instruction_added", expect.anything());
  });

  it("the scrim discards too; SAVE on a cleared draft removes the note", async () => {
    store.dispatch(setCartInstructions("extra sauce"));
    renderBag();
    await openSheet();
    fireEvent.click(screen.getByTestId("instructions-scrim"));
    expect(instructions()).toBe("extra sauce");
    expect(mocks.capture).toHaveBeenCalledWith("Add_instruction_dismissed", {});

    await openSheet();
    fireEvent.click(screen.getByTestId("instructions-clear"));
    fireEvent.click(screen.getByTestId("instructions-save"));
    expect(instructions()).toBe("");
    expect(mocks.capture).toHaveBeenCalledWith("instruction_added", { instruction_length: 0 });
    expect(screen.getByTestId("bag-instructions-text")).toHaveTextContent("Add a note for the kitchen");
  });

  it("the sheet sits inside the bag (z-50 over the bag's z-40 context)", async () => {
    renderBag();
    const sheet = await openSheet();
    expect(screen.getByTestId("bag-sheet")).toContainElement(sheet);
    expect(sheet).toHaveClass("absolute", "inset-0", "z-50");
  });
});
