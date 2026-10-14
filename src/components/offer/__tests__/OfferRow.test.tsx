/* eslint-disable @typescript-eslint/no-explicit-any --
 * Ranked-entry fixtures mirror the untyped SDK offer payloads; typed in the
 * P7+ domain passes. Do not add NEW anys.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OfferRow from "../OfferRow";
import i18n from "../../../i18n";

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
    // offers-parity D8: the radio is the full-row overlay; the text is the body's.
    const body = screen.getByTestId("offer-row-body-offer-flat-2");
    expect(body).toHaveTextContent("£2 off your order");
    // posistKiosk's OffersSheet amt(): moduloCalcaledValue — a whole saving whole.
    expect(body).toHaveTextContent(/Save £2(?![\d.])/);
    expect(screen.getByText("Save £2")).toHaveAttribute("dir", "auto"); // the leaf, never the row
    // text-start: without it the parent's physical text-left keeps a wrapped AR line left-aligned.
    expect(screen.getByText("Save £2")).toHaveClass("text-start");
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

  it("motion §3.2: the picked dot pops in as it mounts; the 1032 px row itself never bumps", () => {
    renderRow();
    expect(screen.getByTestId("offer-radio-offer-flat-2").firstElementChild).toBeNull();

    cleanup();
    renderRow({ selected: true });
    expect(screen.getByTestId("offer-radio-offer-flat-2").firstElementChild).toHaveClass("tb-pop-in");
    expect(screen.getByTestId("offer-row-offer-flat-2")).not.toHaveClass("tb-select");
  });

  it("upTo certainty renders 'Save up to £X'", () => {
    renderRow({
      entry: eligibleEntry({
        saving: { amount: 2, certainty: "upTo", kind: "freeItem", requiresChoice: true },
      }),
    });
    expect(screen.getByTestId("offer-row-body-offer-flat-2")).toHaveTextContent(
      /Save up to £2(?![\d.])/
    );
  });

  it("applied: shows the Applied chip", () => {
    renderRow({ applied: true, selected: true });
    expect(screen.getByTestId("offer-row-body-offer-flat-2")).toHaveTextContent("Applied");
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
 * Walk 2026-10-14: "Free item with your order" sat above "Get 1 Noodles
 * (FULL) at 50% off". A get reward says "free" only when every get clause
 * is 100 % off; otherwise the mechanic line names the discount (the
 * description, which prints each clause's) — never "free".
 * ------------------------------------------------------------------ */
describe("OfferRow — a discounted get reward is never labelled free", () => {
  const NOODLES = { id: "noodles", name: "Noodles", price: 5 };
  const getEntry = (discountType: string, value: number) => ({
    _id: "gi-noodles-full",
    relation: "and",
    quantity: 1,
    discountType,
    value,
    entities: NOODLES,
  });
  const getOffer = (kind: "freeItem" | "bogo" | "groupWise", items: object[], categories: object[] = []) => ({
    ...offerBase,
    _id: `offer-${kind}`,
    name: "Variant With And With Category",
    type: { name: "item", value: 0 },
    getItemOnly: kind === "freeItem",
    buygetGroupWiseOffer: kind === "groupWise",
    buygetGroupWiseOfferValues: { discountType: "percent", value: 50, getQuantity: 2, buyQuantity: 1 },
    minBillAmount: 100,
    applicable: {
      ...offerBase.applicable,
      rawItems: kind === "freeItem" ? [] : [{ item: { baseItemId: "burger" }, quantity: 1, relation: "and" }],
    },
    getItems: { items, categories },
  });
  /** Locked by the bill minimum: the mechanic line IS the second line. */
  const locked = (offer: any, kind: string) => ({
    offer,
    saving: { amount: 0, certainty: "upTo", kind, requiresChoice: true, lockReason: "minBill" },
    eligible: false,
    gap: { reason: "minBill", amountShort: 40 },
  });
  const DESCRIPTION = "Get 1 Noodles (FULL) at 50% off";

  it("a 50 %-off free-item get: the second line names the discount (the description), never 'Free item…', and is not repeated", () => {
    renderRow({ entry: locked(getOffer("freeItem", [getEntry("percent", 50)]), "freeItem"), description: DESCRIPTION });
    const row = screen.getByTestId("offer-row-offer-freeItem");
    expect(row).toHaveTextContent(DESCRIPTION);
    expect(row).not.toHaveTextContent(/free/i);
    expect(screen.queryByTestId("offer-row-desc-offer-freeItem")).toBeNull();
  });

  it("…with no description to name it, a neutral discounted line — still never 'free'", () => {
    renderRow({ entry: locked(getOffer("freeItem", [getEntry("amount", 2)]), "freeItem") });
    const row = screen.getByTestId("offer-row-offer-freeItem");
    expect(row).toHaveTextContent("Discounted item with your order");
    expect(row).not.toHaveTextContent(/free/i);
  });

  it("a 1 %-off category pick counts too (the clause the description prints for a group)", () => {
    const chinese = {
      _id: "chinese",
      name: "Chinese",
      quantity: 2,
      relation: "and",
      discountType: "percent",
      value: 1,
      entities: [{ id: "chilli", name: "Chilli Manchurian", price: 20, type: "ITEM" }],
    };
    renderRow({ entry: locked(getOffer("freeItem", [getEntry("percent", 100)], [chinese]), "freeItem") });
    expect(screen.getByTestId("offer-row-offer-freeItem")).not.toHaveTextContent("Free item with your order");
  });

  it("bogo and group-wise lines follow the same rule", () => {
    renderRow({ entry: locked(getOffer("bogo", [getEntry("percent", 50)]), "bogo") });
    expect(screen.getByTestId("offer-row-offer-bogo")).toHaveTextContent("Discounted item with your order");
    expect(screen.getByTestId("offer-row-offer-bogo")).not.toHaveTextContent(/free/i);
    cleanup();
    renderRow({ entry: locked(getOffer("groupWise", [getEntry("percent", 50)]), "groupWise") });
    expect(screen.getByTestId("offer-row-offer-groupWise")).toHaveTextContent("Discounted item with your order");
    expect(screen.getByTestId("offer-row-offer-groupWise")).not.toHaveTextContent(/free/i);
  });

  it("every clause 100 % off: the free lines stay", () => {
    renderRow({ entry: locked(getOffer("freeItem", [getEntry("percent", 100)]), "freeItem") });
    expect(screen.getByTestId("offer-row-offer-freeItem")).toHaveTextContent("Free item with your order");
    cleanup();
    renderRow({ entry: locked(getOffer("bogo", [getEntry("percent", 100)]), "bogo") });
    expect(screen.getByTestId("offer-row-offer-bogo")).toHaveTextContent("Buy & get free — pick yours");
    cleanup();
    renderRow({ entry: locked(getOffer("groupWise", [getEntry("percent", 100)]), "groupWise") });
    expect(screen.getByTestId("offer-row-offer-groupWise")).toHaveTextContent("Pick 2 free");
  });

  // Review of the walk fixes: computeLeastValueDiscount applies
  // leastItemValueCount.getDiscount %, so the least-value line follows the
  // same rule — "free" only at 100 % (no getDiscount reads as 100).
  describe("least-value", () => {
    const least = (getQuantity: number, getDiscount: number | null) => ({
      offer: {
        ...offerBase,
        _id: `offer-least-${getQuantity}-${getDiscount}`,
        name: "LeastValue Offer",
        type: { name: "item", value: 0 },
        getLeastValueItem: true,
        leastItemValueCount: { buyQuantity: 3, getQuantity, getDiscount },
      },
      saving: { amount: 4, certainty: "exact", kind: "leastValue", requiresChoice: false },
      eligible: true,
      gap: undefined,
    });
    const desc = (entry: any) => screen.getByTestId(`offer-row-desc-${entry.offer._id}`);

    it("below 100 % the line names the discount — one or several cheapest — never 'free'", () => {
      const two = least(2, 50);
      renderRow({ entry: two });
      expect(desc(two)).toHaveTextContent(/^Buy 3, your 2 cheapest items are 50% off$/);
      cleanup();
      const one = least(1, 50);
      renderRow({ entry: one });
      expect(desc(one)).toHaveTextContent(/^Buy 3, your cheapest item is 50% off$/);
    });

    it("100 %, or no getDiscount at all, stays free", () => {
      const full = least(2, 100);
      renderRow({ entry: full });
      expect(desc(full)).toHaveTextContent(/^Buy 3, your 2 cheapest items are free$/);
      cleanup();
      const unset = least(1, null);
      renderRow({ entry: unset });
      expect(desc(unset)).toHaveTextContent(/^Buy 3, your cheapest item is free$/);
    });

    it("Arabic names the discount too", async () => {
      await i18n.changeLanguage("ar");
      try {
        const two = least(2, 50);
        renderRow({ entry: two });
        expect(desc(two)).toHaveTextContent(i18n.t("offers.mechLeastValueDiscountOther", { buy: 3, get: 2, value: 50 }));
        expect(desc(two).textContent).toMatch(/\p{Script=Arabic}/u);
        expect(desc(two).textContent).not.toBe(i18n.t("offers.mechLeastValueOther", { buy: 3, get: 2 }));
      } finally {
        await i18n.changeLanguage("en");
      }
    });
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

  it("offers-parity (flipped): a minItems row handed onAddItems stacks the nudge AND ADD ITEMS in the 206 px column", async () => {
    const onAddItems = vi.fn();
    const { onPick } = renderRow({
      entry: lockedEntry({ ...FLAT_OFFER, _id: "offer-min-items", minItemCount: 3 }, "amountComplete", {
        reason: "minItems",
        countShort: 2,
      }),
      onAddItems,
    });
    const nudge = screen.getByTestId("offer-row-nudge-offer-min-items");
    expect(nudge).toHaveTextContent("Add 2 more items to your order to be eligible to redeem this reward");
    const addItems = screen.getByTestId("offer-row-add-items-offer-min-items");
    expect(addItems.tagName).toBe("BUTTON");
    // One 206 px column holds both, the nudge first.
    const column = nudge.parentElement as HTMLElement;
    expect(column).toHaveClass("w-[206px]");
    expect(column).toContainElement(addItems);
    expect(nudge.compareDocumentPosition(addItems) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(addItems);
    expect(onAddItems).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("walk 2026-10-14: the minItems nudge is plural-aware — the REWARD REMOVED notice's own wording, EN and AR", async () => {
    const minItems = (countShort: number) =>
      lockedEntry({ ...FLAT_OFFER, _id: "offer-min-items", minItemCount: 3 }, "amountComplete", {
        reason: "minItems",
        countShort,
      });
    renderRow({ entry: minItems(1) });
    expect(screen.getByTestId("offer-row-nudge-offer-min-items")).toHaveTextContent(
      /^Add 1 more item to your order to be eligible to redeem this reward$/
    );
    cleanup();
    renderRow({ entry: minItems(3) });
    expect(screen.getByTestId("offer-row-nudge-offer-min-items")).toHaveTextContent(
      /^Add 3 more items to your order to be eligible to redeem this reward$/
    );
    cleanup();

    await i18n.changeLanguage("ar");
    try {
      renderRow({ entry: minItems(2) });
      const nudge = screen.getByTestId("offer-row-nudge-offer-min-items");
      expect(nudge).toHaveTextContent(i18n.t("offers.addNudgeItems", { count: 2 }));
      expect(nudge.textContent).toMatch(/\p{Script=Arabic}/u);
      expect(nudge.textContent).not.toMatch(/\+/);
      expect(nudge.textContent).not.toBe(i18n.t("offers.addNudgeItems", { count: 1 }));
    } finally {
      await i18n.changeLanguage("en");
    }
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
    expect(row).toHaveTextContent(/Save £2(?![\d.])/);

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
    const button = screen.getByTestId("offer-row-body-offer-flat-2");
    expect(button).toHaveClass("border-t", "border-tb-grey-4", "pt-[23px]", "pb-[24px]", "gap-[24px]");
    expect(button).not.toHaveClass("border-b");
    expect(button.querySelector(".h-\\[152px\\].w-\\[152px\\]")).not.toBeNull();
    // The title (the mechanic line under it now reads the same "£2 off your order").
    expect(button.querySelector('[id$="-title"]')).toHaveTextContent(/^£2 off your order$/);
    expect(button.querySelector('[id$="-title"]')).toHaveClass("text-[32px]", "leading-[36px]", "font-medium", "capitalize");
    expect(screen.getByText("Save £2")).toHaveClass("text-[24px]", "leading-[24px]", "text-tb-ink-purple");
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

/* ------------------------------------------------------------------ *
 * Lane offers-parity (F3, Figma 1:4034 collapsed / 1:4069 expanded):
 * the description under the second line — 2 lines + Show more / Show less
 * (CTA/Show more 1:1687), shown only when clamped — and D8, the eligible
 * row as a div whose LAST child is the full-row radio, named by the title,
 * described by the second line + the description; the toggle sits above it.
 * ------------------------------------------------------------------ */
describe("OfferRow — description, Show more, overlay radio (offers-parity)", () => {
  const LONG =
    "Buy 2 Heineken or 2 Choclate Truffle & get 1 Kingfisher at 50% off or 1 Choclate Brownie at 70% off";

  /** A ResizeObserver that reports at once (the browser's first observation). */
  class FiringResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  /** Every element measures `scroll` tall inside a `client` box. */
  const measure = (scroll: number, client: number) => {
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(scroll);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(client);
  };
  // setupTests installs a silent, writable (not configurable) ResizeObserver.
  const silentResizeObserver = window.ResizeObserver;
  const reporting = () => {
    window.ResizeObserver = FiringResizeObserver as unknown as typeof ResizeObserver;
  };
  const clamped = () => {
    reporting();
    measure(60, 40);
  };

  afterEach(() => {
    vi.restoreAllMocks();
    window.ResizeObserver = silentResizeObserver;
  });

  it("the description sits under the second line, a dir=auto leaf in Text/Small grey (1:4069)", () => {
    renderRow({ description: LONG });
    const line = screen.getByText("Save £2");
    const desc = screen.getByTestId("offer-row-desc-offer-flat-2");
    expect(desc).toHaveTextContent(LONG);
    expect(line.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(desc).toHaveAttribute("dir", "auto");
    expect(desc).toHaveClass("text-start", "text-[18px]", "leading-[20px]", "text-tb-grey-1", "line-clamp-2");
  });

  it("no description block when it repeats the second line, and none on a gone row", () => {
    renderRow({ description: "Save £2" });
    expect(screen.queryByTestId("offer-row-desc-offer-flat-2")).toBeNull();
    cleanup();

    renderRow({
      entry: {
        offer: { ...FLAT_OFFER, _id: "offer-gone", isAvailable: false },
        saving: { amount: 2, certainty: "exact", kind: "amountComplete", requiresChoice: false, lockReason: "unavailable" },
        eligible: false,
        gap: { reason: "unavailable" },
      },
      description: LONG,
    });
    expect(screen.queryByTestId("offer-row-desc-offer-gone")).toBeNull();
    expect(screen.getByTestId("offer-row-offer-gone")).toHaveTextContent("Not available right now");
  });

  it("without a description the mechanic line steps in (and is hidden when it IS the second line)", () => {
    renderRow();
    // Eligible flat-2: "Save £2" + the mechanic line under it.
    expect(screen.getByTestId("offer-row-desc-offer-flat-2")).toHaveTextContent("£2 off your order");
    cleanup();
    renderRow({
      entry: {
        offer: PERCENT_OFFER,
        saving: { amount: 0, certainty: "exact", kind: "percentComplete", requiresChoice: false, lockReason: "minBill" },
        eligible: false,
        gap: { reason: "minBill", amountShort: 16.4 },
      },
    });
    // Locked minBill: the mechanic line already IS the second line.
    expect(screen.queryByTestId("offer-row-desc-offer-percent-25")).toBeNull();
  });

  it("an itemCriteria lock shows the scoped lockLine; a scoped description feeds the mechanic line", () => {
    renderRow({
      entry: {
        offer: { ...FLAT_OFFER, _id: "offer-scoped", type: { name: "percent", value: 10 }, applicable: { ...offerBase.applicable, on: "itemCriteria" } },
        saving: { amount: 0, certainty: "exact", kind: "percentItems", requiresChoice: false, lockReason: "itemCriteria" },
        eligible: false,
        gap: { reason: "itemCriteria" },
      },
      description: "10% off everything except Beer",
      lockLine: "Not valid on Beer",
    });
    const row = screen.getByTestId("offer-row-offer-scoped");
    expect(row).toHaveTextContent("Not valid on Beer");
    expect(row).not.toHaveTextContent("Needs specific items in your order");
    expect(screen.getByTestId("offer-row-desc-offer-scoped")).toHaveTextContent("10% off everything except Beer");
  });

  it("Show more renders only when the collapsed block overflows", () => {
    reporting();
    measure(40, 40);
    renderRow({ description: LONG });
    expect(screen.queryByTestId("offer-row-more-offer-flat-2")).toBeNull();
    cleanup();

    clamped();
    renderRow({ description: LONG });
    expect(screen.getByTestId("offer-row-more-offer-flat-2")).toHaveTextContent("Show more");
  });

  it("Show more expands (aria-expanded + aria-controls), stays while expanded, Show less collapses; never picks", async () => {
    clamped();
    const onPick = vi.fn();
    const row = (selected: boolean) => (
      <OfferRow
        entry={eligibleEntry() as never}
        selected={selected}
        applied={false}
        currency="£"
        disabled={false}
        onPick={onPick}
        description={LONG}
      />
    );
    const { rerender } = render(row(false));
    const toggle = screen.getByTestId("offer-row-more-offer-flat-2");
    const desc = screen.getByTestId("offer-row-desc-offer-flat-2");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", desc.id);
    expect(desc.id).not.toBe("");
    // Told apart from every other row's "Show more" by the title.
    expect(toggle).toHaveAccessibleDescription("£2 off your order");

    await userEvent.click(toggle);
    expect(onPick).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Show less");
    expect(desc).not.toHaveClass("line-clamp-2");

    // Expanded, the block no longer overflows — the toggle stays (measured collapsed only).
    measure(60, 60);
    rerender(row(true));
    expect(screen.getByTestId("offer-row-more-offer-flat-2")).toHaveTextContent("Show less");

    measure(60, 40);
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(desc).toHaveClass("line-clamp-2");
    expect(onPick).not.toHaveBeenCalled();
    // A tap anywhere else on the row still picks (the overlay radio).
    await userEvent.click(screen.getByTestId("offer-row-offer-flat-2"));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("the toggle is a ≥44 px target in CTA/Show more (1:1687): Exp Bd 16/24, underlined tb-purple", () => {
    clamped();
    renderRow({ description: LONG });
    const toggle = screen.getByTestId("offer-row-more-offer-flat-2");
    expect(toggle.className).toMatch(/min-h-\[44px\]/);
    expect(toggle.className).toMatch(/min-w-\[44px\]/);
    expect(toggle).toHaveClass("tb-display", "text-[16px]", "leading-[24px]", "text-tb-purple", "underline");
  });

  it("D8: no nested buttons; the radio is named by the title and described by the second line + the description", () => {
    clamped();
    const { container } = render(
      <OfferRow
        entry={eligibleEntry() as never}
        selected={false}
        applied={false}
        currency="£"
        disabled={false}
        onPick={vi.fn()}
        description={LONG}
      />
    );
    expect(container.querySelector("button button")).toBeNull();
    const radio = screen.getByRole("radio", { name: "£2 off your order" });
    expect(radio).toBe(screen.getByTestId("offer-row-offer-flat-2"));
    expect(radio).toHaveAccessibleDescription(`Save £2 ${LONG}`);
    // The overlay is the body's LAST child; the toggle is a sibling above it.
    const body = screen.getByTestId("offer-row-body-offer-flat-2");
    expect(body.lastElementChild).toBe(radio);
    const toggle = screen.getByTestId("offer-row-more-offer-flat-2");
    expect(radio.contains(toggle)).toBe(false);
    expect(toggle).toHaveClass("relative", "z-[1]");
  });

  it("locked rows carry the description too (and their toggle), still inert divs", () => {
    clamped();
    renderRow({
      entry: {
        offer: { ...FLAT_OFFER, _id: "offer-bogo", type: { name: "item", value: 0 } },
        saving: { amount: 2, certainty: "upTo", kind: "bogo", requiresChoice: true, lockReason: "bogoBuySide" },
        eligible: false,
        gap: { reason: "bogoBuySide" },
      },
      description: LONG,
    });
    const row = screen.getByTestId("offer-row-offer-bogo");
    expect(row.tagName).toBe("DIV");
    expect(screen.getByTestId("offer-row-desc-offer-bogo")).toHaveTextContent(LONG);
    expect(screen.getByTestId("offer-row-more-offer-bogo")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("review 2: the applied row's radio announces 'Applied' (its description) — checked or not", () => {
    renderRow({ applied: true, selected: false, description: LONG });
    const radio = screen.getByRole("radio", { name: "£2 off your order" });
    expect(radio).toHaveAccessibleDescription(`Applied Save £2 ${LONG}`);
  });

  it("review 2: a D3-blocked row keeps its description clamped with NO toggle — no live control inside the dimmed, aria-disabled row", () => {
    clamped();
    renderRow({ blocked: true, description: LONG });
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("offer-row-desc-offer-flat-2")).toHaveClass("line-clamp-2");
    expect(screen.queryByTestId("offer-row-more-offer-flat-2")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
