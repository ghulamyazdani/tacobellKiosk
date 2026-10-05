/* eslint-disable @typescript-eslint/no-explicit-any --
 * Ranked-entry fixtures mirror the untyped SDK offer payloads; typed in the
 * P7+ domain passes. Do not add NEW anys.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("Expired offer")).toHaveClass("line-through");
    expect(row).toHaveTextContent("Not available right now");
    expect(screen.queryByTestId("offer-radio-offer-gone")).not.toBeInTheDocument();
    expect(screen.queryByTestId("offer-row-nudge-offer-gone")).not.toBeInTheDocument();
  });
});
