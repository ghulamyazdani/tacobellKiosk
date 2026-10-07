/* eslint-disable @typescript-eslint/no-explicit-any --
 * Ranked-entry fixtures mirror the untyped SDK offer payloads; typed in the
 * P7+ domain passes. Do not add NEW anys.
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OfferRow from "../OfferRow";
import "../../../i18n";

/** Contract mock-offer base (only the fields OfferRow's copy paths read). */
const offerBase = {
  isAvailable: true,
  isComplimentary: false,
  getItemOnly: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  minBillAmount: null as number | null,
  minItemCount: null as number | null,
  maxDiscount: null as number | null,
  applicable: { on: "complete", isExclude: false, isInclude: false, rawItems: [] as any[] },
  getItems: {},
  leastItemValueCount: { buyQuantity: null, getQuantity: null },
  buygetGroupWiseOfferValues: {
    discountType: "percent",
    value: null,
    getQuantity: null,
    buyQuantity: null,
  },
};

const FLAT_OFFER = {
  ...offerBase,
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
};

const PERCENT_OFFER = {
  ...offerBase,
  _id: "offer-percent-25",
  name: "25% off your order",
  type: { name: "percent", value: 25 },
  minBillAmount: 25,
};

const eligibleEntry = (overrides: any = {}) => ({
  offer: FLAT_OFFER,
  saving: { amount: 2, certainty: "exact", kind: "amountComplete", requiresChoice: false },
  eligible: true,
  gap: undefined,
  ...overrides,
});

const renderRow = (props: any = {}) => {
  const onPick = vi.fn();
  render(
    <OfferRow
      entry={eligibleEntry()}
      selected={false}
      applied={false}
      currency="£"
      disabled={false}
      onPick={onPick}
      {...props}
    />
  );
  return { onPick };
};

describe("OfferRow (Figma rewards 1:3824 / 1:3858 — one sheet row)", () => {
  it("eligible: radio button row with 'Save £X' second line; tap calls onPick", async () => {
    const { onPick } = renderRow();
    const row = screen.getByTestId("offer-row-offer-flat-2");
    expect(row).toHaveAttribute("role", "radio");
    expect(row).toHaveAttribute("aria-checked", "false");
    expect(row).toHaveTextContent("£2 off your order");
    expect(row).toHaveTextContent("Save £2.00");
    expect(screen.getByText("Save £2.00")).toHaveAttribute("dir", "auto"); // the leaf, never the row
    // text-start: without it the parent's physical text-left keeps a wrapped AR line left-aligned.
    expect(screen.getByText("Save £2.00")).toHaveClass("text-start");
    expect(row).not.toHaveAttribute("dir");
    expect(screen.getByTestId("offer-radio-offer-flat-2")).toBeInTheDocument();
    expect(screen.queryByTestId("offer-row-nudge-offer-flat-2")).not.toBeInTheDocument();
    await userEvent.click(row);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("selected: aria-checked reflects the sheet's pick", () => {
    renderRow({ selected: true });
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("upTo certainty renders 'Save up to £X'", () => {
    renderRow({
      entry: eligibleEntry({
        saving: { amount: 2, certainty: "upTo", kind: "freeItem", requiresChoice: true },
      }),
    });
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveTextContent(
      "Save up to £2.00"
    );
  });

  it("applied: shows the Applied chip", () => {
    renderRow({ applied: true, selected: true });
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveTextContent("Applied");
  });

  it("disabled latch: the eligible row's button is disabled and onPick never fires", async () => {
    const { onPick } = renderRow({ disabled: true });
    const row = screen.getByTestId("offer-row-offer-flat-2");
    expect(row).toBeDisabled();
    await userEvent.click(row);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("locked minBill: pink right-nudge with the shortfall, NO radio, and the mechanic line in the second slot", () => {
    const { onPick } = renderRow({
      entry: {
        offer: PERCENT_OFFER,
        saving: {
          amount: 0,
          certainty: "exact",
          kind: "percentComplete",
          requiresChoice: false,
          lockReason: "minBill",
        },
        eligible: false,
        gap: { reason: "minBill", amountShort: 16.4 },
      },
    });
    const row = screen.getByTestId("offer-row-offer-percent-25");
    // Locked rows are informational — never a pressable radio.
    expect(row.tagName).toBe("DIV");
    // …but NOT disabled: the nudge is live copy (axe must check its contrast).
    expect(row).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByTestId("offer-radio-offer-percent-25")).not.toBeInTheDocument();
    const nudge = screen.getByTestId("offer-row-nudge-offer-percent-25");
    expect(nudge).toHaveTextContent(
      "Add £16.40+ to your order to be eligible to redeem this reward"
    );
    // minBill keeps the mechanic copy in the second line (nudge carries the gap).
    expect(row).toHaveTextContent("25% off your order");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("locked itemCriteria: copy moves into the second line and there is no right-nudge", () => {
    renderRow({
      entry: {
        offer: { ...FLAT_OFFER, _id: "offer-scoped" },
        saving: {
          amount: 0,
          certainty: "exact",
          kind: "amountItems",
          requiresChoice: false,
          lockReason: "itemCriteria",
        },
        eligible: false,
        gap: { reason: "itemCriteria" },
      },
    });
    const row = screen.getByTestId("offer-row-offer-scoped");
    expect(row).toHaveTextContent("Needs specific items in your order");
    expect(screen.queryByTestId("offer-row-nudge-offer-scoped")).not.toBeInTheDocument();
  });

  it("gone (unavailable): struck name, unavailable copy, no radio and no nudge", () => {
    renderRow({
      entry: {
        offer: { ...FLAT_OFFER, _id: "offer-gone", name: "Expired offer", isAvailable: false },
        saving: {
          amount: 1,
          certainty: "exact",
          kind: "amountComplete",
          requiresChoice: false,
          lockReason: "unavailable",
        },
        eligible: false,
        gap: { reason: "unavailable" },
      },
    });
    const row = screen.getByTestId("offer-row-offer-gone");
    expect(row.tagName).toBe("DIV");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Expired offer")).toHaveClass("line-through");
    expect(row).toHaveTextContent("Not available right now");
    expect(screen.queryByTestId("offer-radio-offer-gone")).not.toBeInTheDocument();
    expect(screen.queryByTestId("offer-row-nudge-offer-gone")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Lane "offers" (item 31): the ADD ITEMS buy-stage entry. Only a LOCKED
 * bogoBuySide row renders it, and only when the sheet hands it onAddItems.
 * ------------------------------------------------------------------ */
describe("OfferRow — ADD ITEMS on locked bogoBuySide rows", () => {
  const BOGO_OFFER = {
    ...offerBase,
    _id: "offer-bogo",
    name: "Buy 2 sauces get a Caesar free",
    type: { name: "item", value: 0 },
    applicable: {
      ...offerBase.applicable,
      rawItems: [{ item: { baseItemId: "tortilla-sauce" }, quantity: 2, relation: "and" }],
    },
  };

  const lockedEntry = (offer: any, kind: string, gap: any) => ({
    offer,
    saving: { amount: 2, certainty: "exact", kind, requiresChoice: false, lockReason: gap.reason },
    eligible: false,
    gap,
  });

  const BOGO_LOCKED = lockedEntry(BOGO_OFFER, "bogo", { reason: "bogoBuySide" });

  it("renders ADD ITEMS (a ≥44 px button inside the div row) and a tap calls onAddItems once — never onPick", async () => {
    const onAddItems = vi.fn();
    const { onPick } = renderRow({ entry: BOGO_LOCKED, onAddItems });

    const row = screen.getByTestId("offer-row-offer-bogo");
    expect(row.tagName).toBe("DIV");
    expect(row).toHaveTextContent("Add the qualifying items to unlock this reward");
    const addItems = screen.getByTestId("offer-row-add-items-offer-bogo");
    expect(addItems.tagName).toBe("BUTTON");
    expect(row).toContainElement(addItems);
    expect(addItems).toHaveTextContent("ADD ITEMS");
    expect(addItems.className).toMatch(/min-h-\[44px\]/);
    expect(addItems.className).toMatch(/min-w-\[44px\]/);

    await userEvent.click(addItems);
    expect(onAddItems).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("without onAddItems the bogoBuySide row stays inert (no button)", () => {
    renderRow({ entry: BOGO_LOCKED });
    expect(screen.getByTestId("offer-row-offer-bogo")).toHaveTextContent(
      "Add the qualifying items to unlock this reward"
    );
    expect(screen.queryByTestId("offer-row-add-items-offer-bogo")).not.toBeInTheDocument();
  });

  it("the disabled latch (a commit in flight) disables ADD ITEMS", async () => {
    const onAddItems = vi.fn();
    renderRow({ entry: BOGO_LOCKED, onAddItems, disabled: true });
    const addItems = screen.getByTestId("offer-row-add-items-offer-bogo");
    expect(addItems).toBeDisabled();
    await userEvent.click(addItems);
    expect(onAddItems).not.toHaveBeenCalled();
  });

  it.each([
    [
      "minBill",
      lockedEntry(PERCENT_OFFER, "percentComplete", { reason: "minBill", amountShort: 16.4 }),
      "Add £16.40+ to your order to be eligible to redeem this reward",
    ],
    [
      "minItems",
      lockedEntry({ ...FLAT_OFFER, _id: "offer-min-items", minItemCount: 3 }, "amountComplete", {
        reason: "minItems",
        countShort: 2,
      }),
      null,
    ],
    [
      "itemCriteria",
      lockedEntry({ ...FLAT_OFFER, _id: "offer-scoped" }, "amountItems", { reason: "itemCriteria" }),
      "Needs specific items in your order",
    ],
    [
      "gone",
      lockedEntry({ ...FLAT_OFFER, _id: "offer-gone", isAvailable: false }, "amountComplete", {
        reason: "unavailable",
      }),
      "Not available right now",
    ],
  ])("%s rows are unchanged even when handed onAddItems: no ADD ITEMS", (_label, entry, copy) => {
    const onAddItems = vi.fn();
    renderRow({ entry, onAddItems });
    const id = String(entry.offer._id);
    const row = screen.getByTestId(`offer-row-${id}`);
    expect(row.tagName).toBe("DIV");
    expect(screen.queryByTestId(`offer-row-add-items-${id}`)).not.toBeInTheDocument();
    expect(row.querySelector("button")).toBeNull();
    if (copy) expect(row).toHaveTextContent(copy);
  });

  it("the minItems nudge still names the item shortfall", () => {
    renderRow({
      entry: lockedEntry({ ...FLAT_OFFER, _id: "offer-min-items", minItemCount: 3 }, "amountComplete", {
        reason: "minItems",
        countShort: 2,
      }),
      onAddItems: vi.fn(),
    });
    expect(screen.getByTestId("offer-row-nudge-offer-min-items")).toBeInTheDocument();
  });

  it("an eligible row never shows ADD ITEMS (it is the radio)", () => {
    renderRow({ onAddItems: vi.fn() });
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveAttribute("role", "radio");
    expect(screen.queryByTestId("offer-row-add-items-offer-flat-2")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Lane loyalty-visual.
 *  - D3 `blocked` (a XENO reward in the bag, no offer applied): every row
 *    — an eligible one too — is the inert div, aria-disabled and dimmed,
 *    with no radio, nudge or ADD ITEMS; it centres (no nudge column).
 *  - D2 geometry (Figma 1:3842): hairline above each row inside the 24 gap
 *    (200 pitch), 152 plate, 32/36 title, 24/24 line, 206 nudge column.
 * ------------------------------------------------------------------ */
describe("OfferRow — D3 blocked + D2 geometry (lane loyalty-visual)", () => {
  const MIN_BILL_LOCKED = {
    offer: PERCENT_OFFER,
    saving: { amount: 0, certainty: "exact", kind: "percentComplete", requiresChoice: false, lockReason: "minBill" },
    eligible: false,
    gap: { reason: "minBill", amountShort: 16.4 },
  };
  const BOGO_LOCKED = {
    offer: {
      ...offerBase,
      _id: "offer-bogo",
      name: "Buy 2 sauces get a Caesar free",
      type: { name: "item", value: 0 },
      applicable: {
        ...offerBase.applicable,
        rawItems: [{ item: { baseItemId: "tortilla-sauce" }, quantity: 2, relation: "and" }],
      },
    },
    saving: { amount: 2, certainty: "exact", kind: "bogo", requiresChoice: false, lockReason: "bogoBuySide" },
    eligible: false,
    gap: { reason: "bogoBuySide" },
  };
  const GONE = {
    offer: { ...FLAT_OFFER, _id: "offer-gone", name: "Expired offer", isAvailable: false },
    saving: { amount: 1, certainty: "exact", kind: "amountComplete", requiresChoice: false, lockReason: "unavailable" },
    eligible: false,
    gap: { reason: "unavailable" },
  };

  it("blocked eligible row: the inert div — aria-disabled, dimmed, no radio; the saving still reads; a tap never picks", async () => {
    const { onPick } = renderRow({ blocked: true, selected: true });
    const row = screen.getByTestId("offer-row-offer-flat-2");

    expect(row.tagName).toBe("DIV");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveClass("opacity-50", "items-center");
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("aria-checked");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByTestId("offer-radio-offer-flat-2")).toBeNull();
    expect(row).toHaveTextContent("£2 off your order");
    expect(row).toHaveTextContent("Save £2.00");

    await userEvent.click(row);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("blocked locked minBill row: no nudge, and it centres; unblocked it keeps the nudge, top-aligned and live", () => {
    renderRow({ entry: MIN_BILL_LOCKED, blocked: true });
    const row = screen.getByTestId("offer-row-offer-percent-25");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveClass("opacity-50", "items-center");
    expect(row).not.toHaveClass("items-start");
    expect(screen.queryByTestId("offer-row-nudge-offer-percent-25")).toBeNull();
    cleanup();

    renderRow({ entry: MIN_BILL_LOCKED });
    const live = screen.getByTestId("offer-row-offer-percent-25");
    expect(live).not.toHaveAttribute("aria-disabled");
    expect(live).not.toHaveClass("opacity-50");
    expect(live).toHaveClass("items-start");
    expect(screen.getByTestId("offer-row-nudge-offer-percent-25")).toBeInTheDocument();
  });

  it("blocked bogoBuySide row handed onAddItems: no ADD ITEMS (no button at all)", () => {
    const onAddItems = vi.fn();
    renderRow({ entry: BOGO_LOCKED, onAddItems, blocked: true });
    const row = screen.getByTestId("offer-row-offer-bogo");

    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("offer-row-add-items-offer-bogo")).toBeNull();
    expect(row.querySelector("button")).toBeNull();
  });

  it("blocked gone row: still struck, inactive and dimmed", () => {
    renderRow({ entry: GONE, blocked: true });
    const row = screen.getByTestId("offer-row-offer-gone");

    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveClass("opacity-50");
    expect(screen.getByText("Expired offer")).toHaveClass("line-through");
    expect(row).toHaveTextContent("Not available right now");
  });

  it("D2: both row kinds carry the hairline ABOVE inside the 24 gap, the 152 plate, 32/36 title and 24/24 line; the nudge is the 206 column", () => {
    renderRow();
    const button = screen.getByTestId("offer-row-offer-flat-2");
    expect(button).toHaveClass("border-t", "border-tb-grey-4", "pt-[23px]", "pb-[24px]", "gap-[24px]");
    expect(button).not.toHaveClass("border-b");
    expect(button.querySelector(".h-\\[152px\\].w-\\[152px\\]")).not.toBeNull();
    expect(screen.getByText("£2 off your order")).toHaveClass("text-[32px]", "leading-[36px]", "font-medium", "capitalize");
    expect(screen.getByText("Save £2.00")).toHaveClass("text-[24px]", "leading-[24px]", "text-tb-ink-purple");
    cleanup();

    renderRow({ entry: MIN_BILL_LOCKED });
    const div = screen.getByTestId("offer-row-offer-percent-25");
    expect(div).toHaveClass("border-t", "border-tb-grey-4", "pt-[23px]", "pb-[24px]");
    expect(div.querySelector(".h-\\[152px\\].w-\\[152px\\]")).not.toBeNull();
    const nudge = screen.getByTestId("offer-row-nudge-offer-percent-25");
    expect(nudge).toHaveClass("w-[206px]", "pt-[48px]", "text-[24px]", "leading-[24px]", "text-start");
    // A wrapping leaf: start-aligned in English, right-aligned when Arabic resolves RTL.
    expect(nudge).toHaveAttribute("dir", "auto");
  });
});
