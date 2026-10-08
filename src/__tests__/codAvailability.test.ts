import { describe, expect, it } from "vitest";
import { checkIfCODAvailable } from "@cx-sdk/payments/gateways/paymentOptions";

/*
  audit-fixes A2 (PAR-06) — the SDK's `checkIfCODAvailable` is the fork's LIVE
  rule (fork src/pages/PaymentSelection.tsx:66-92): the row by `name` or
  `label`, the session tab by `tabs[].tabType` (the take-out spellings as one
  family, D-A2-1) and ONLY a tab-level `selected === true` turns COD off
  (D-A2-2). The old SDK export matched `tabs[].tabLabel` and ignored
  `selected`, so every table / delivery session lost COD under the Cockpit
  default row — case (a) pins that regression.

  The fixture is the Cockpit default row (posistApp app.js:19418-19437, the
  projected fields cx.controller.js returns) inside a realistic
  deploymentInfoSettings array. /payment's own fail-open wrapper (an empty
  blob or tab type keeps COD on) is PaymentSelection.test's.
*/

type Tab = { tabLabel: string; tabType: string; selected: boolean };

const TABS = (ticked: string[] = []): Tab[] =>
  [
    { tabLabel: "Table", tabType: "table" },
    { tabLabel: "Take Out", tabType: "takeout" },
    { tabLabel: "Delivery", tabType: "delivery" },
  ].map((tab) => ({ ...tab, selected: ticked.includes(tab.tabType) }));

/** The Cockpit default — every tab unticked. */
const codRow = (overrides: Record<string, unknown> = {}) => ({
  name: "disable_cod_kiosk",
  label: "Disable COD for Kiosk",
  selected: false,
  tabs: TABS(),
  ...overrides,
});

/** deploymentInfoSettings as the boot stores it: the COD row among others. */
const settings = (row: Record<string, unknown> | null) => [
  { name: "disable_roundoff", label: "Disable Round Off", selected: false },
  ...(row ? [row] : []),
  { name: "inclusive_tax", label: "Inclusive Tax", selected: true },
];

describe("checkIfCODAvailable — the fork's live rule (A2)", () => {
  it.each(["table", "delivery", "takeout", "take_out", "dine_in"])(
    "(a) the Cockpit default row, every tab unticked → COD ON for %s (the old SDK said false for table / delivery)",
    (tab) => {
      expect(checkIfCODAvailable(tab, settings(codRow()))).toBe(true);
    }
  );

  it("(b) Table ticked → OFF for table only", () => {
    const blob = settings(codRow({ tabs: TABS(["table"]) }));

    expect(checkIfCODAvailable("table", blob)).toBe(false);
    expect(checkIfCODAvailable("TABLE", blob)).toBe(false); // case-insensitive
    expect(checkIfCODAvailable("takeout", blob)).toBe(true);
    expect(checkIfCODAvailable("delivery", blob)).toBe(true);
    expect(checkIfCODAvailable("dine_in", blob)).toBe(true);
  });

  it.each(["takeout", "take_out", "take_away", "takeaway", "Take_Out"])(
    "(c) Take Out ticked → OFF for the take-out spelling %s (D-A2-1: one family)",
    (tab) => {
      expect(checkIfCODAvailable(tab, settings(codRow({ tabs: TABS(["takeout"]) })))).toBe(false);
    }
  );

  it("(c) a ticked take-out tab stays a take-out tab: table / delivery / dine-in keep COD", () => {
    const blob = settings(codRow({ tabs: TABS(["takeout"]) }));

    for (const tab of ["table", "delivery", "dine_in", "takeout_x", "take"]) {
      expect(checkIfCODAvailable(tab, blob), tab).toBe(true);
    }
  });

  it.each([
    ["name only", { label: undefined }],
    ["label only", { name: undefined }],
  ])("(d) a %s row is honoured", (_label, keys) => {
    const blob = settings(codRow({ ...keys, tabs: TABS(["delivery"]) }));

    expect(checkIfCODAvailable("delivery", blob)).toBe(false);
    expect(checkIfCODAvailable("table", blob)).toBe(true);
  });

  it("(d) a row with neither key is not the COD row", () => {
    const blob = settings(
      codRow({ name: "something_else", label: "Something else", tabs: TABS(["table"]) })
    );

    expect(checkIfCODAvailable("table", blob)).toBe(true);
  });

  it.each([
    ["no tabs", { tabs: undefined }],
    ["empty tabs", { tabs: [] }],
    ["null tabs", { tabs: null }],
    ["a tab without a tabType", { tabs: [{ tabLabel: "Table", selected: true }] }],
  ])("(e) %s → COD ON", (_label, overrides) => {
    expect(checkIfCODAvailable("table", settings(codRow(overrides)))).toBe(true);
  });

  it("(e) tabLabel is no longer matched: a ticked LABEL with another tabType keeps COD", () => {
    const blob = settings(
      codRow({ tabs: [{ tabLabel: "table", tabType: "delivery", selected: true }] })
    );

    expect(checkIfCODAvailable("table", blob)).toBe(true);
    expect(checkIfCODAvailable("delivery", blob)).toBe(false);
  });

  it("(f) no COD row → ON; a null blob or an empty tab type → false (unchanged; /payment fails open itself)", () => {
    expect(checkIfCODAvailable("table", settings(null))).toBe(true);
    expect(checkIfCODAvailable("table", [])).toBe(true);
    expect(checkIfCODAvailable("table", null)).toBe(false);
    expect(checkIfCODAvailable("table", undefined)).toBe(false);
    expect(checkIfCODAvailable("", settings(codRow({ tabs: TABS(["table"]) })))).toBe(false);
    expect(checkIfCODAvailable(undefined, settings(codRow()))).toBe(false);
  });

  it("(f) the blob may be an object map, not only an array (Object.values)", () => {
    const blob = { a: codRow({ tabs: TABS(["table"]) }) };

    expect(checkIfCODAvailable("table", blob)).toBe(false);
    expect(checkIfCODAvailable("delivery", blob)).toBe(true);
  });

  it("(g) D-A2-2: the row's own selected:false is ignored — a ticked tab still turns COD off", () => {
    const blob = settings(codRow({ selected: false, tabs: TABS(["table"]) }));

    expect(checkIfCODAvailable("table", blob)).toBe(false);
  });

  it("(g) only selected === true counts — truthy non-booleans do not", () => {
    const blob = settings(
      codRow({
        tabs: [
          { tabLabel: "Table", tabType: "table", selected: "true" },
          { tabLabel: "Delivery", tabType: "delivery", selected: 1 },
        ],
      })
    );

    expect(checkIfCODAvailable("table", blob)).toBe(true);
    expect(checkIfCODAvailable("delivery", blob)).toBe(true);
  });
});
