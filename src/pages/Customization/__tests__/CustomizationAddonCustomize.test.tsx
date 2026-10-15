/* eslint-disable @typescript-eslint/no-explicit-any --
 * Tier-1 rows / cart rows mirror the untyped legacy makeItAMeal + cart
 * slices (the CustomizationEdit / CustomizationPack fixtures' precedent).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  makeItAMealTier2BottomSheet,
  MIAMTier2Open,
  openMakeItAMealModal,
  openMakeItAMealSession,
  openTier1Modal,
  setIsForceOpenMakeItAMealModal,
  setTeir1SelectedEntity,
  setTier1BottomSheet,
  setTier1BottomSheetAndSelectedEntity,
  setTier1SelectedCustomization,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setEntityMenuObject, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency, setHideComboConstituentAddons } from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import { setSelectedEntity } from "../../../redux/features/menuSelections/menuSelections.slice";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import GlobalErrorHost from "../../../components/common/GlobalErrorHost";
import Customization from "../index";
import i18n from "../../../i18n";

/*
  Lane addon-customize (user decisions 2026-10-09; contract v3 §2, §4, §5,
  §10.3): a PDP option card whose item has options of its own is Figma
  1:5332's two-button card — CUSTOMIZE (on a pick only) above CHOOSE /
  REMOVE — in EVERY card group (`_combo` and `_addons` alike), with the
  fork's flow: a REQUIRED add-on's CHOOSE opens its customize page NEW, an
  all-optional one is added pre-shaped, a tap on a pick edits it, a swap
  away from a customized pick asks first, and a customized pick's REMOVE
  asks first. Every group holding such a card is 476 px tall.
*/

const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];
const AR_FRIES = "بطاطس كبيرة";
const opt = (id: string, name: string, price: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  price,
  isActive: true,
  modifiers: [],
  ...extra,
});
const grp = (id: string, name: string, min: number, max: number, items: unknown[], order: number, extra: Record<string, unknown> = {}) => ({
  _id: id,
  name,
  min,
  max,
  multiplePunchMin: min,
  multiplePunchMax: max,
  multiplePunchMaxItem: 1,
  order,
  isActive: true,
  constituentItems: items,
  ...extra,
});

// ---- The add-ons' OWN groups ----
const SALT = grp("fries_salt_addons", "Salt", 0, 1, [opt("no-salt", "No Salt", 0.5)], 1);
/** Inactive and min 1: never seeded, never validated (the fork's raw seed fails PAY — §11 D6). */
const FRIES_X = grp("fries_x_addons", "Hidden", 1, 1, [opt("hidden", "Hidden", 0)], 2, { isActive: false });
const SAUCE = grp("bbq_sauce_addons", "Sauce", 1, 1, [opt("plain", "Plain", 0), opt("smoky", "Smoky", 0.25)], 1);

// ---- The PDP's options ----
const FRIES = opt("fries", "Large Fries", 3, { aliases: AR(AR_FRIES) });
const FRIES2 = opt("fries2", "Large Fries 2", 2);
const BBQ = opt("bbq", "BBQ Sauce", 1);
const BBQ2 = opt("bbq2", "BBQ Sauce 2", 1);
const CHIPS = opt("chips", "Chips", 1);
const WINGS = opt("wings", "Wings", 1);
const KETCHUP = opt("ketchup", "Ketchup", 0);
const SLAW = opt("slaw", "Slaw", 2);

// ---- The PDP's groups ----
const SNACKS = grp("pack_snacks_combo", "Snacks", 0, 2, [CHIPS, FRIES, BBQ, WINGS], 1);
const EXTRAS = grp("pack_extras_addons", "Extras", 0, 2, [FRIES, BBQ, KETCHUP], 2);
/** A NON-slot swap (an `_addons` 1/1 over three options). */
const SWAP = grp("pack_side_addons", "Side", 1, 1, [FRIES2, SLAW, BBQ2], 3);
/** Item max 2 → stepper rows (OptionRow): never the two-button card. */
const ROWS = grp("pack_dips_addons", "Dips", 0, 4, [FRIES], 4, { multiplePunchMaxItem: 2 });
const PLAIN_G = grp("pack_sauce_addons", "Sauces", 0, 1, [opt("mayo", "Mayo", 0), opt("mustard", "Mustard", 0)], 5);
const TOGGLE = grp("pack_toggle_addons", "Toggle", 0, 0, [BBQ, FRIES], 6);
/** A pack slot (`_combo` raw 1/1): PackSlotCard's surface. */
const SLOT = grp("pack_drink_combo", "Drink", 1, 1, [FRIES, BBQ], 7);

const PACK = {
  id: "pack",
  name: "Pack",
  price: 16,
  applyAddonsPrice: true,
  modifiers: [SNACKS, EXTRAS, SWAP, ROWS, PLAIN_G].map((g) => g._id),
};

const entity = (id: string, name: string, modifiers: string[], extra: Record<string, unknown> = {}) => ({
  id,
  name,
  price: 9,
  isActive: true,
  outOfStock: false,
  subCategoryId: "sides",
  modifiers,
  ...extra,
});
const ENTITIES = {
  fries: entity("fries", "Large Fries", [SALT._id, FRIES_X._id], { aliases: AR(AR_FRIES) }),
  fries2: entity("fries2", "Large Fries 2", [SALT._id]),
  bbq: entity("bbq", "BBQ Sauce", [SAUCE._id]),
  bbq2: entity("bbq2", "BBQ Sauce 2", [SAUCE._id]),
};

const ALL_GROUPS = [SNACKS, EXTRAS, SWAP, ROWS, PLAIN_G, TOGGLE, SLOT, SALT, FRIES_X, SAUCE];
const seedMenu = (groups: Record<string, unknown>[] = ALL_GROUPS, entities: Record<string, unknown> = ENTITIES) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: Object.fromEntries(groups.map((g) => [g._id, g])) }));
  store.dispatch(setEntityMenuObject({ menuEntityObject: entities }));
};
const seed = (pdpEntity: Record<string, unknown> = PACK, groups?: Record<string, unknown>[], entities?: Record<string, unknown>) => {
  seedMenu(groups, entities);
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
      selectedEntity: pdpEntity,
    })
  );
};

const renderPdp = (state?: unknown) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/customization", state }]}>
        <Customization />
        <GlobalErrorHost />
      </MemoryRouter>
    </Provider>
  );

const tap = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element);
  });
};
const LAZY = { timeout: 5000 }; // the tier-2 page rides the lazy bagLazyParts chunk (PROGRESS.md: a known flake at 1 s)

const groupEl = (g: { _id: string }) => screen.getByTestId(`pdp-group-${g._id}`);
const inGroup = (g: { _id: string }) => within(groupEl(g));
const card = (g: { _id: string }, id: string) => inGroup(g).getByTestId(`pdp-option-${id}`);
const cta = (g: { _id: string }, id: string) => inGroup(g).getByTestId(`pdp-option-cta-${id}`);
const customizeOf = (g: { _id: string }, id: string) => inGroup(g).getByTestId(`pdp-option-customize-${id}`);
const bodyOf = (g: { _id: string }, id: string) => inGroup(g).getByTestId(`pdp-option-select-${id}`);
const rowsOf = (g: { _id: string }): any[] => (tier1SelectedCustomization(store.getState()) as any)?.[g._id] ?? [];
const idsOf = (g: { _id: string }) => rowsOf(g).map((row) => row.id);
const total = () => screen.getByTestId("pdp-add-to-bag").textContent ?? "";
const tier2Open = () => Boolean(MIAMTier2Open(store.getState()));
const tier2OpenType = () => (makeItAMealTier2BottomSheet(store.getState()) as any)?.openType;
const sheet = () => screen.findByTestId("tier2-sheet", undefined, LAZY);
const tier2Card = async (id: string) => within(await sheet()).findByTestId(`tier2-option-${id}`, undefined, LAZY);
const save = () => tap(screen.getByTestId("tier2-sheet-save"));
const back = () => tap(screen.getByTestId("tier2-sheet-close"));
const guard = () => screen.queryByTestId("pdp-tier2-tap-guard");
const gotIt = () => tap(screen.getByTestId("global-error-ok"));
const strip = (s: string | null | undefined) => (s ?? "").replace(/[⁦-⁩]/g, "");

/** CHOOSE an all-optional fries-like option, then CUSTOMIZE → No Salt → UPDATE. */
const customizeWithNoSalt = async (g: { _id: string }, id: string) => {
  if (!rowsOf(g).some((row) => row.id === id)) await tap(cta(g, id));
  await tap(customizeOf(g, id));
  await tap(await tier2Card("no-salt"));
  await save();
  expect(screen.queryByTestId("tier2-sheet")).toBeNull();
};

describe("PDP add-on CUSTOMIZE — Figma 1:5332's two-button card, the fork's flow (lane addon-customize)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("1 · heights (decision 4): EVERY card of a group holding a card with own options is 476 / 210 — plain cards too; other groups stay 400 / 134; a tap never changes them", async () => {
    seed();
    renderPdp();
    const tallGroups: Array<[{ _id: string }, string[]]> = [
      [SNACKS, ["chips", "fries", "bbq", "wings"]],
      [EXTRAS, ["fries", "bbq", "ketchup"]],
      [SWAP, ["fries2", "slaw", "bbq2"]],
    ];
    const expectTall = () => {
      for (const [g, ids] of tallGroups) {
        for (const id of ids) {
          expect(card(g, id), `${g._id} ${id}`).toHaveClass("min-h-[476px]");
          expect(card(g, id), `${g._id} ${id}`).not.toHaveClass("min-h-[400px]");
          expect(card(g, id).querySelector(".min-h-\\[210px\\]"), `${g._id} ${id}`).not.toBeNull();
        }
      }
    };
    expectTall();
    for (const id of ["mayo", "mustard"]) {
      expect(card(PLAIN_G, id)).toHaveClass("min-h-[400px]");
      expect(card(PLAIN_G, id).querySelector(".min-h-\\[134px\\]")).not.toBeNull();
    }
    // Stepper rows stay rows.
    expect(card(ROWS, "fries")).not.toHaveClass("min-h-[476px]");
    expect(inGroup(ROWS).queryByTestId("pdp-option-cta-fries")).toBeNull();

    await tap(cta(SNACKS, "chips"));
    await tap(cta(SNACKS, "fries"));
    expectTall();
    await tap(cta(SNACKS, "fries"));
    expectTall();
  });

  it("2 · unpicked (decision 3): an option with own options shows CHOOSE alone — a real button named 'Choose <item>'; a plain card stays addon-cta's one-button card", () => {
    seed();
    renderPdp();

    for (const id of ["fries", "bbq"]) {
      expect(cta(SNACKS, id).tagName).toBe("BUTTON");
      expect(cta(SNACKS, id)).toHaveTextContent(i18n.t("pack.choose"));
      expect(inGroup(SNACKS).queryByTestId(`pdp-option-customize-${id}`)).toBeNull();
    }
    expect(cta(SNACKS, "fries")).toHaveAccessibleName(`${i18n.t("pack.choose")} Large Fries`);
    expect(card(SNACKS, "fries").tagName).toBe("DIV");
    expect(card(SNACKS, "chips").tagName).toBe("BUTTON");
    expect(card(SNACKS, "chips")).toHaveAttribute("aria-pressed", "false");
    expect(card(SNACKS, "chips")).toHaveAccessibleName("Chips");
  });

  it("3 · CHOOSE an ALL-OPTIONAL add-on (row 2, D6): no page; ONE pre-shaped row — itemId, only the active own key, the group stamps, the option's price; CUSTOMIZE + REMOVE", async () => {
    seed();
    renderPdp();

    await tap(cta(SNACKS, "fries"));

    expect(tier2Open()).toBe(false);
    const rows = rowsOf(SNACKS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "fries", price: 3, quantity: 1, min: 0, max: 2, multiplePunchMaxItem: 1 });
    expect(rows[0].itemId).toMatch(/^\d+_fries$/);
    expect(Object.keys(rows[0].customizations)).toEqual([SALT._id]);
    expect(customizeOf(SNACKS, "fries")).toHaveTextContent(i18n.t("pack.customize"));
    expect(cta(SNACKS, "fries")).toHaveTextContent(i18n.t("pack.remove"));
    expect(card(SNACKS, "fries")).toHaveAttribute("data-selected", "true");
    expect(total()).toContain("£19.00");
  });

  it("4 · CUSTOMIZE → the page in EDIT: the own group (not the inactive one), £3.00 → £3.50; UPDATE keeps ONE row with the same itemId; CUSTOMIZE again shows the pick", async () => {
    seed();
    renderPdp();
    await tap(cta(SNACKS, "fries"));
    const itemId = rowsOf(SNACKS)[0].itemId;

    await tap(customizeOf(SNACKS, "fries"));
    expect(await screen.findByTestId(`tier2-group-${SALT._id}`, undefined, LAZY)).toBeInTheDocument();
    expect(tier2OpenType()).toBe("edit");
    expect(screen.queryByTestId(`tier2-group-${FRIES_X._id}`)).toBeNull();
    expect(screen.getByTestId("tier2-price-line")).toHaveTextContent("£3.00");
    await tap(await tier2Card("no-salt"));
    expect(screen.getByTestId("tier2-price-line")).toHaveTextContent("£3.50");
    await save();

    expect(tier2Open()).toBe(false);
    const rows = rowsOf(SNACKS);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe(itemId);
    expect(Object.keys(rows[0].customizations)).toEqual([SALT._id]);
    expect(rows[0].customizations[SALT._id].map((p: any) => p.id)).toEqual(["no-salt"]);
    expect(total()).toContain("£19.50");

    await tap(customizeOf(SNACKS, "fries"));
    expect(await tier2Card("no-salt")).toHaveAttribute("aria-pressed", "true");
  });

  it("5 · REMOVE on a CUSTOMIZED pick asks first (decision 5); a body tap on it opens EDIT instead (D10)", async () => {
    seed();
    renderPdp();
    await customizeWithNoSalt(SNACKS, "fries");

    // The body (overlay) of a pick is CUSTOMIZE: EDIT, never the remove prompt.
    await tap(bodyOf(SNACKS, "fries"));
    await sheet();
    expect(tier2OpenType()).toBe("edit");
    expect(screen.queryByTestId("pdp-addon-remove")).toBeNull();
    await back();
    expect(rowsOf(SNACKS)).toHaveLength(1);

    await tap(cta(SNACKS, "fries"));
    const dialog = screen.getByTestId("pdp-addon-remove");
    expect(dialog).toHaveAttribute("role", "alertdialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent(i18n.t("pdp.discardTitle"));
    expect(dialog).toHaveTextContent(i18n.t("pdp.discardBody"));
    expect(screen.getByTestId("pdp-addon-remove-cancel")).toHaveTextContent(i18n.t("pdp.keepItem"));
    const yes = screen.getByTestId("pdp-addon-remove-confirm");
    expect(yes).toHaveTextContent(i18n.t("pdp.removeThisItem"));
    // Focus on NO, KEEP IT — the safe choice (walk 2026-10-14).
    expect(screen.getByTestId("pdp-addon-remove-cancel")).toHaveFocus();
    expect(yes).not.toHaveFocus();
    expect(yes).toHaveClass("bg-tb-red");

    await tap(screen.getByTestId("pdp-addon-remove-cancel"));
    expect(screen.queryByTestId("pdp-addon-remove")).toBeNull();
    expect(rowsOf(SNACKS)).toHaveLength(1);
    expect(total()).toContain("£19.50");
    expect(guard()).toBeInTheDocument();

    await tap(cta(SNACKS, "fries"));
    await tap(screen.getByTestId("pdp-addon-remove-confirm"));
    expect(screen.queryByTestId("pdp-addon-remove")).toBeNull();
    expect(rowsOf(SNACKS)).toEqual([]);
    expect(total()).toContain("£16.00");
  });

  it("6 · REMOVE on a pick with no own pick (row 7) is immediate", async () => {
    seed();
    renderPdp();
    await tap(cta(SNACKS, "fries"));

    await tap(cta(SNACKS, "fries"));

    expect(screen.queryByTestId("pdp-addon-remove")).toBeNull();
    expect(rowsOf(SNACKS)).toEqual([]);
    expect(cta(SNACKS, "fries")).toHaveTextContent(i18n.t("pack.choose"));
  });

  it("7 · CHOOSE a REQUIRED add-on (row 1, D4): the page NEW, nothing committed; an empty UPDATE is refused; BACK commits nothing; Plain → UPDATE commits it", async () => {
    seed();
    renderPdp();

    await tap(cta(SNACKS, "bbq"));
    expect(await screen.findByTestId(`tier2-group-${SAUCE._id}`, undefined, LAZY)).toBeInTheDocument();
    expect(tier2OpenType()).toBe("new");
    expect(idsOf(SNACKS)).toEqual([]);

    await save();
    expect(screen.getByTestId(`tier2-group-${SAUCE._id}`)).toHaveClass("ring-4", "ring-red-500");
    expect(screen.getByTestId("global-error")).toHaveTextContent(i18n.t("pdp.customizationErrors"));
    await gotIt();
    expect(idsOf(SNACKS)).toEqual([]);

    await back();
    expect(tier2Open()).toBe(false);
    expect(idsOf(SNACKS)).toEqual([]);

    await tap(cta(SNACKS, "bbq"));
    await tap(await tier2Card("plain"));
    await save();
    const rows = rowsOf(SNACKS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "bbq", quantity: 1 });
    expect(rows[0].itemId).toMatch(/_bbq$/);
    expect(rows[0].customizations[SAUCE._id].map((p: any) => p.id)).toEqual(["plain"]);
    expect(total()).toContain("£17.00");
  });

  it("7b · CHOOSE a REQUIRED add-on when tier-1 holds no key for its group (a row restored without it): the plan's key lands with the page, so UPDATE commits the pick", async () => {
    seed();
    renderPdp();
    await act(async () => {
      const { [SNACKS._id]: _gone, ...rest } = tier1SelectedCustomization(store.getState()) as Record<string, unknown[]>;
      store.dispatch(setTier1SelectedCustomization(rest));
    });
    expect(Object.keys(tier1SelectedCustomization(store.getState()) as object)).not.toContain(SNACKS._id);

    await tap(cta(SNACKS, "bbq"));
    await tap(await tier2Card("plain"));
    await save();
    expect(tier2Open()).toBe(false);
    expect(idsOf(SNACKS)).toEqual(["bbq"]);
  });

  it("8 · an `_addons` group gets the same flow (C1): CUSTOMIZE → No Salt → UPDATE lands the own pick (PDP £19.50 — the bill side is e2e E4); a REQUIRED CHOOSE opens NEW", async () => {
    seed();
    renderPdp();

    await tap(cta(EXTRAS, "fries"));
    expect(customizeOf(EXTRAS, "fries")).toBeInTheDocument();
    await customizeWithNoSalt(EXTRAS, "fries");
    expect(rowsOf(EXTRAS)[0].customizations[SALT._id].map((p: any) => p.id)).toEqual(["no-salt"]);
    expect(total()).toContain("£19.50");

    await tap(cta(EXTRAS, "bbq"));
    expect(await screen.findByTestId(`tier2-group-${SAUCE._id}`, undefined, LAZY)).toBeInTheDocument();
    expect(tier2OpenType()).toBe("new");
  });

  it("9 · a FULL group refuses a card with own options out loud (rows 4–6): no page, no row", async () => {
    seed();
    renderPdp();
    await tap(cta(SNACKS, "chips"));
    await tap(cta(SNACKS, "wings"));
    expect(groupEl(SNACKS)).toHaveTextContent(i18n.t("pdp.groupCount", { count: 2, max: 2 }));
    const refusal = i18n.t("pdp.groupMaxReached", { max: 2, group: "Snacks" });

    await tap(cta(SNACKS, "bbq"));
    expect(screen.getByTestId("global-error")).toHaveTextContent(refusal);
    expect(tier2Open()).toBe(false);
    await gotIt();

    await tap(cta(SNACKS, "fries"));
    expect(screen.getByTestId("global-error")).toHaveTextContent(refusal);
    await gotIt();
    expect(idsOf(SNACKS)).toEqual(["chips", "wings"]);

    await tap(cta(EXTRAS, "ketchup"));
    await tap(cta(EXTRAS, "fries"));
    expect(idsOf(EXTRAS)).toEqual(["ketchup", "fries"]);
    await tap(cta(EXTRAS, "bbq"));
    expect(screen.getByTestId("global-error")).toHaveTextContent(i18n.t("pdp.groupMaxReached", { max: 2, group: "Extras" }));
    expect(tier2Open()).toBe(false);
    expect(idsOf(EXTRAS)).toEqual(["ketchup", "fries"]);
  });

  it("9b · a toggle (0/0) card group refuses them too (row 18 — the guard fails open on max 0)", async () => {
    seed({ ...PACK, modifiers: [...PACK.modifiers, TOGGLE._id] });
    renderPdp();

    await tap(cta(TOGGLE, "bbq"));
    expect(screen.getByTestId("global-error")).toBeInTheDocument();
    expect(tier2Open()).toBe(false);
    await gotIt();

    await tap(cta(TOGGLE, "fries"));
    expect(screen.getByTestId("global-error")).toBeInTheDocument();
    expect(idsOf(TOGGLE)).toEqual([]);
  });

  it("9d · a group with NO max at all (missing) refuses them up front too (user decision 2026-10-14): '0 of 0', the fork's group limit, the customize page never opens", async () => {
    const NO_MAX = { ...TOGGLE, max: undefined, multiplePunchMax: undefined };
    seed(
      { ...PACK, modifiers: [...PACK.modifiers, TOGGLE._id] },
      ALL_GROUPS.map((g) => (g._id === TOGGLE._id ? NO_MAX : g)),
    );
    renderPdp();
    const refusal = i18n.t("pdp.groupNoMax", { group: "Toggle" });
    expect(groupEl(TOGGLE)).toHaveTextContent(i18n.t("pdp.groupCount", { count: 0, max: 0 }));

    await tap(cta(TOGGLE, "bbq")); // REQUIRED own options: the page NEW
    expect(screen.getByTestId("global-error")).toHaveTextContent(refusal);
    expect(tier2Open()).toBe(false);
    await gotIt();

    await tap(cta(TOGGLE, "fries")); // all-optional: the pre-shaped pick
    expect(screen.getByTestId("global-error")).toHaveTextContent(refusal);
    expect(idsOf(TOGGLE)).toEqual([]);
  });

  it("9c · a REFUSED tap leaves another group's red ring alone (pre-lane: the hook refuses before its ring reset); a tap that lands still clears it", async () => {
    seed();
    renderPdp();
    await tap(cta(SNACKS, "chips"));
    await tap(cta(SNACKS, "fries")); // all-optional: the pre-shaped pick
    expect(idsOf(SNACKS)).toEqual(["chips", "fries"]);
    await tap(screen.getByTestId("pdp-add-to-bag")); // Side (1/1) is still empty
    await tap(screen.getByTestId("pdp-incomplete-gotit"));
    const ringed = () => groupEl(SWAP).classList.contains("ring-red-500");
    expect(ringed()).toBe(true);
    const refusal = i18n.t("pdp.groupMaxReached", { max: 2, group: "Snacks" });

    await tap(cta(SNACKS, "wings")); // a plain card: the hook's guard refuses (row 6)
    expect(screen.getByTestId("global-error")).toHaveTextContent(refusal);
    await gotIt();
    expect(ringed()).toBe(true);

    await tap(cta(SNACKS, "bbq")); // own options: the planner refuses (row 4)
    expect(screen.getByTestId("global-error")).toHaveTextContent(refusal);
    await gotIt();
    expect(ringed()).toBe(true);
    expect(idsOf(SNACKS)).toEqual(["chips", "fries"]);

    await tap(cta(SWAP, "slaw"));
    expect(idsOf(SWAP)).toEqual(["slaw"]);
    expect(ringed()).toBe(false);
  });

  it("10 · a swap group (rows 10–17): pre-shaped pick, body tap = EDIT, the replace prompt (NO / YES), a REQUIRED swap opens NEW and only UPDATE swaps", async () => {
    seed();
    renderPdp();
    const replaceTitle = (name: string) => i18n.t("pdp.replaceTitle", { name });

    // Row 11: the pre-shaped pick; a swap pick has CUSTOMIZE and no lower button.
    await tap(cta(SWAP, "fries2"));
    expect(tier2Open()).toBe(false);
    expect(idsOf(SWAP)).toEqual(["fries2"]);
    expect(inGroup(SWAP).queryByTestId("pdp-option-cta-fries2")).toBeNull();
    await customizeWithNoSalt(SWAP, "fries2");
    expect(total()).toContain("£18.50");

    // Row 17 / D10: the body of the swap pick opens EDIT; BACK keeps its own pick.
    await tap(bodyOf(SWAP, "fries2"));
    expect(await tier2Card("no-salt")).toHaveAttribute("aria-pressed", "true");
    expect(tier2OpenType()).toBe("edit");
    await back();
    expect(rowsOf(SWAP)[0].customizations[SALT._id]).toHaveLength(1);
    expect(total()).toContain("£18.50");

    // Row 16: a PLAIN card replacing a customized pick asks.
    await tap(cta(SWAP, "slaw"));
    expect(screen.getByTestId("pdp-addon-replace")).toHaveTextContent(replaceTitle("Large Fries 2"));
    // Focus on NO, KEEP IT — the safe choice (walk 2026-10-14).
    expect(screen.getByTestId("pdp-addon-replace-cancel")).toHaveFocus();
    await tap(screen.getByTestId("pdp-addon-replace-cancel"));
    expect(screen.queryByTestId("pdp-addon-replace")).toBeNull();
    expect(idsOf(SWAP)).toEqual(["fries2"]);
    await tap(cta(SWAP, "slaw"));
    await tap(screen.getByTestId("pdp-addon-replace-confirm"));
    expect(idsOf(SWAP)).toEqual(["slaw"]);

    // Row 12 (A3): REQUIRED over a plain pick → NEW with no prompt; BACK keeps the pick.
    await tap(cta(SWAP, "bbq2"));
    expect(screen.queryByTestId("pdp-addon-replace")).toBeNull();
    expect(await screen.findByTestId(`tier2-group-${SAUCE._id}`, undefined, LAZY)).toBeInTheDocument();
    await back();
    expect(idsOf(SWAP)).toEqual(["slaw"]);
    await tap(cta(SWAP, "bbq2"));
    await tap(await tier2Card("plain"));
    await save();
    expect(idsOf(SWAP)).toEqual(["bbq2"]);

    // CUSTOMIZE bbq2 → Smoky (the pick stays customized).
    await tap(customizeOf(SWAP, "bbq2"));
    await tap(await tier2Card("smoky"));
    await save();
    expect(rowsOf(SWAP)[0].customizations[SAUCE._id].map((p: any) => p.id)).toEqual(["smoky"]);

    // Row 15: an all-optional card over it asks; YES swaps in the pre-shaped row.
    await tap(cta(SWAP, "fries2"));
    expect(screen.getByTestId("pdp-addon-replace")).toHaveTextContent(replaceTitle("BBQ Sauce 2"));
    await tap(screen.getByTestId("pdp-addon-replace-confirm"));
    expect(idsOf(SWAP)).toEqual(["fries2"]);
    expect(rowsOf(SWAP)[0].customizations).toEqual({ [SALT._id]: [] });

    // Row 14: a REQUIRED card over a customized pick asks; YES opens NEW; BACK keeps the old pick.
    await customizeWithNoSalt(SWAP, "fries2");
    await tap(cta(SWAP, "bbq2"));
    expect(screen.getByTestId("pdp-addon-replace")).toHaveTextContent(replaceTitle("Large Fries 2"));
    await tap(screen.getByTestId("pdp-addon-replace-confirm"));
    expect(await screen.findByTestId(`tier2-group-${SAUCE._id}`, undefined, LAZY)).toBeInTheDocument();
    expect(tier2OpenType()).toBe("new");
    await back();
    expect(idsOf(SWAP)).toEqual(["fries2"]);
    expect(rowsOf(SWAP)[0].customizations[SALT._id]).toHaveLength(1);
  });

  it("11 · surfaces (D1): no CUSTOMIZE on stepper rows, pack slots or the customize page's own cards (no tier 3)", async () => {
    // SALT also offers bbq — an option with options of its own — on the page.
    const saltWithBbq = { ...SALT, max: 2, multiplePunchMax: 2, constituentItems: [...SALT.constituentItems, BBQ] };
    seed({ ...PACK, modifiers: [...PACK.modifiers, SLOT._id] }, ALL_GROUPS.map((g) => (g._id === SALT._id ? saltWithBbq : g)));
    renderPdp();

    expect(inGroup(ROWS).queryAllByTestId(/^pdp-option-customize-/)).toEqual([]);
    expect(within(screen.getByTestId("pack-slot-grid")).queryAllByTestId(/^pdp-option-/)).toEqual([]);
    expect(screen.queryByTestId(`pdp-group-${SLOT._id}`)).toBeNull();

    await tap(cta(SNACKS, "fries"));
    await tap(customizeOf(SNACKS, "fries"));
    const page = await sheet();
    await tier2Card("bbq");
    expect(within(page).queryAllByRole("button", { name: new RegExp(`^${i18n.t("pack.customize")}`) })).toEqual([]);
    expect(within(page).queryAllByTestId(/^pdp-option-customize-/)).toEqual([]);
  });

  it.each([
    ["hide_combo_constituent_add_ons", () => store.dispatch(setHideComboConstituentAddons(true)), ENTITIES],
    ["an out-of-stock fries entity", () => undefined, { ...ENTITIES, fries: { ...ENTITIES.fries, outOfStock: true } }],
  ])("11b · no CUSTOMIZE for fries under %s (the resolver answers {})", async (_label, arrange, entities) => {
    seed(PACK, ALL_GROUPS, entities);
    arrange();
    renderPdp();

    await tap(card(SNACKS, "fries"));
    expect(idsOf(SNACKS)).toEqual(["fries"]);
    expect(inGroup(SNACKS).queryByTestId("pdp-option-customize-fries")).toBeNull();
    expect(tier2Open()).toBe(false);
  });

  it.each([
    ["a freebie (isGetItem)", { isGetItem: true }],
    ["a loyalty reward (isLoyaltyItem)", { isLoyaltyItem: true }],
  ])("12 · %s offers CUSTOMIZE too (C3 — the fork's card has no such gate)", async (_label, flag) => {
    seed({ ...PACK, ...flag });
    renderPdp();

    await tap(cta(SNACKS, "fries"));
    expect(customizeOf(SNACKS, "fries")).toBeInTheDocument();
  });

  it("13 · Arabic: CUSTOMIZE's text and name, and both dialogs' copy, come from the AR keys (substring matches — isolates)", async () => {
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    seed();
    renderPdp();

    await tap(cta(SNACKS, "fries"));
    const button = customizeOf(SNACKS, "fries");
    expect(strip(button.textContent)).toContain(strip(i18n.t("pack.customize")));
    expect(button.getAttribute("aria-label")).toContain(AR_FRIES);
    expect(button).not.toHaveTextContent("Customize");

    await tap(button);
    await tap(await tier2Card("no-salt"));
    await save();
    await tap(cta(SNACKS, "fries"));
    const remove = screen.getByTestId("pdp-addon-remove");
    for (const key of ["pdp.discardTitle", "pdp.discardBody", "pdp.keepItem", "pdp.removeThisItem"]) {
      expect(strip(remove.textContent)).toContain(strip(i18n.t(key)));
    }
    await tap(screen.getByTestId("pdp-addon-remove-cancel"));

    await customizeWithNoSalt(SWAP, "fries2");
    await tap(cta(SWAP, "slaw"));
    const replace = screen.getByTestId("pdp-addon-replace");
    expect(strip(replace.textContent)).toContain(strip(i18n.t("pdp.replaceTitle", { name: "Large Fries 2" })));
    expect(strip(replace.textContent)).toContain(strip(i18n.t("pdp.replaceConfirm")));
    expect(replace).not.toHaveTextContent("Replace");
  });

  it("14 · D13: 500 ms tap guard on every CLOSE edge (the page, a prompt's NO / YES) — never on an open edge", async () => {
    seed();
    renderPdp();
    const goneSoon = () => waitFor(() => expect(guard()).toBeNull(), { timeout: 1500 });

    await tap(cta(SNACKS, "fries"));
    expect(guard()).toBeNull();
    await tap(customizeOf(SNACKS, "fries"));
    await sheet();
    expect(guard()).toBeNull();
    await back();
    expect(guard()).toBeInTheDocument();
    expect(guard()).toHaveAttribute("aria-hidden", "true");
    await goneSoon();

    await tap(cta(SNACKS, "bbq"));
    await sheet();
    expect(guard()).toBeNull();
    await back();
    expect(guard()).toBeInTheDocument();
    await goneSoon();

    await customizeWithNoSalt(SNACKS, "fries");
    await goneSoon();
    await tap(cta(SNACKS, "fries"));
    expect(screen.getByTestId("pdp-addon-remove")).toBeInTheDocument();
    expect(guard()).toBeNull();
    await tap(screen.getByTestId("pdp-addon-remove-cancel"));
    expect(guard()).toBeInTheDocument();
    await goneSoon();
    await tap(cta(SNACKS, "fries"));
    await tap(screen.getByTestId("pdp-addon-remove-confirm"));
    expect(guard()).toBeInTheDocument();
    await goneSoon();
  });

  it("15 · stable DOM: CHOOSE keeps the same lower-button node", async () => {
    seed();
    renderPdp();
    const before = cta(SNACKS, "fries");

    await tap(before);

    expect(cta(SNACKS, "fries")).toBe(before);
  });

  it("17 · the page shows the add-on's own groups as TOGGLE cards on this path (§3.4: the fork forces item max 1 on tier-2)", async () => {
    const saltTwo = {
      ...SALT,
      max: 2,
      multiplePunchMax: 2,
      multiplePunchMaxItem: 2,
      constituentItems: [...SALT.constituentItems, opt("sea-salt", "Sea Salt", 0.25)],
    };
    seed(PACK, ALL_GROUPS.map((g) => (g._id === SALT._id ? saltTwo : g)));
    renderPdp();

    await tap(cta(SNACKS, "fries"));
    await tap(customizeOf(SNACKS, "fries"));
    const page = await sheet();
    const noSalt = await tier2Card("no-salt");
    for (const option of ["No Salt", "Sea Salt"]) {
      expect(within(page).queryByRole("button", { name: `${i18n.t("pdp.increase")} ${option}` })).toBeNull();
    }
    expect(noSalt.tagName).toBe("BUTTON");
    expect(within(page).getByTestId("tier2-option-sea-salt").tagName).toBe("BUTTON");
    await tap(noSalt);
    await tap(noSalt);
    expect(noSalt).toHaveAttribute("aria-pressed", "false"); // one unit: the second tap takes it back
  });

  it.each([
    ["false", false, false],
    ["true", true, true],
  ])("18 · the fork's price rule (§3.5): parent applyAddonsPrice %s → own-pick prices on the page shown: %s; CUSTOMIZE is offered either way", async (_label, flag, shown) => {
    seed({ ...PACK, applyAddonsPrice: flag });
    renderPdp();

    await tap(cta(SNACKS, "fries"));
    await tap(customizeOf(SNACKS, "fries"));
    const noSalt = await tier2Card("no-salt");
    const line = screen.getByTestId("tier2-price-line");
    if (shown) {
      expect(line).toHaveTextContent("£3.00");
      expect(noSalt).toHaveTextContent("+£0.50");
    } else {
      expect(line).not.toHaveTextContent("£");
      expect(noSalt).not.toHaveTextContent("+£");
    }
  });
});

/*
  Edit-from-bag (the CustomizationEdit.test seam — BagSheet's contract-B1
  recipe, openType "edit"): a picked add-on shows CUSTOMIZE; a row without an
  itemId is stamped before the page opens (D5), and the EDIT selections are
  exactly the active own groups (stale / inactive keys dropped).
*/
describe("PDP add-on CUSTOMIZE — edit from the bag (case 16)", () => {
  const bagRow = (snacks: unknown[]) => ({
    id: "pack",
    itemId: "pk-1",
    uniqueItemId: "pk-1-u",
    name: "Pack",
    quantity: 1,
    type: "CUSTOMIZABLE",
    price: 16,
    total_price: 17,
    applyAddonsPrice: true,
    customizations: { [SNACKS._id]: snacks, [EXTRAS._id]: [], [SWAP._id]: [], [ROWS._id]: [], [PLAIN_G._id]: [] },
    baseItem: { ...PACK },
    modifiers: PACK.modifiers,
  });
  const seedEdit = (row: ReturnType<typeof bagRow>) => {
    seedMenu();
    store.dispatch(setCartItems([{ ...row }]));
    store.dispatch(openMakeItAMealModal({ isOpen: false, selectedItem: {}, availableCombos: [] }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(openTier1Modal());
    store.dispatch(setTeir1SelectedEntity({ ...row }));
    store.dispatch(
      setTier1BottomSheet({
        isOpen: true,
        type: "customizableItem",
        status: "customizableItem",
        openType: "edit",
        editCustomizationContent: row,
      })
    );
    store.dispatch(setTier1SelectedCustomization(row.customizations));
    store.dispatch(setSelectedEntity({ ...row.baseItem, itemId: row.itemId }));
    store.dispatch(setIsForceOpenMakeItAMealModal(false));
  };

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("16 · a PLAIN required pick (no itemId, no own keys): CUSTOMIZE stamps it and opens EDIT with its own group seeded; an empty UPDATE is refused; Plain → UPDATE", async () => {
    seedEdit(bagRow([{ id: "bbq", name: "BBQ Sauce", price: 1, quantity: 1 }]));
    renderPdp({ direction: "cart" });

    expect(cta(SNACKS, "bbq")).toHaveTextContent(i18n.t("pack.remove"));
    await tap(customizeOf(SNACKS, "bbq"));
    expect(await screen.findByTestId(`tier2-group-${SAUCE._id}`, undefined, LAZY)).toBeInTheDocument();
    expect(tier2OpenType()).toBe("edit");
    const stamped = rowsOf(SNACKS)[0].itemId;
    expect(stamped).toMatch(/_bbq$/);

    await save();
    expect(screen.getByTestId("global-error")).toHaveTextContent(i18n.t("pdp.customizationErrors"));
    await gotIt();
    expect(tier2Open()).toBe(true);

    await tap(await tier2Card("plain"));
    await save();
    expect(tier2Open()).toBe(false);
    const rows = rowsOf(SNACKS);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe(stamped);
    expect(rows[0].customizations).toEqual({ [SAUCE._id]: [expect.objectContaining({ id: "plain" })] });
  });

  it("16b · a legacy row with a stale key and the inactive own key: CUSTOMIZE → pick → UPDATE succeeds, and the keys are exactly the active own group", async () => {
    seedEdit(
      bagRow([
        {
          id: "fries",
          name: "Large Fries",
          price: 3,
          quantity: 1,
          customizations: { gone_addons: [{ id: "z", name: "Gone", price: 0, quantity: 1 }], [FRIES_X._id]: [] },
        },
      ])
    );
    renderPdp({ direction: "cart" });

    await tap(customizeOf(SNACKS, "fries"));
    await tap(await tier2Card("no-salt"));
    await save();

    expect(tier2Open()).toBe(false);
    expect(Object.keys(rowsOf(SNACKS)[0].customizations)).toEqual([SALT._id]);
    expect(rowsOf(SNACKS)[0].customizations[SALT._id].map((p: any) => p.id)).toEqual(["no-salt"]);
  });
});
