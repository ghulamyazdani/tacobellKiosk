import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { setCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
import CountryPickerSheet from "../CountryPickerSheet";
import i18n from "../../../i18n";

/*
  audit-fixes UB5 — the country-code picker sheet (lazy, design language on
  the 1:4488 / 1:2814 shells). Rows come from the SDK table: the space-
  stripped `+digits` codes only, one per ISO code (239), labelled through
  Intl in the UI language, the selected country first then A→Z. Search runs
  on the on-screen keyboard. A pick writes `{…, picked: true}`; scrim / X
  write nothing. The host (CountryPicker) and the pill's "clicked" event are
  CustomerPhone / LoyaltyLoginModal / CountryPicker suites'.
*/

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const country = () =>
  (store.getState() as { auth: { selectedCountryCode: Record<string, unknown> } }).auth
    .selectedCountryCode;

const mount = () => {
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <CountryPickerSheet onClose={onClose} />
    </Provider>
  );
  return { onClose };
};

/** Every country row (a button), in display order. */
const rows = () => [
  ...screen
    .getByTestId("country-list")
    .querySelectorAll<HTMLButtonElement>('button[data-testid^="country-"]'),
];

/** Type on the sheet's on-screen keyboard, switching to the 123 layer and back. */
const type = async (text: string) => {
  for (const key of text) {
    const keyboard = within(screen.getByTestId("kiosk-keyboard"));
    const toggle = keyboard.getByRole("button", { name: i18n.t("keyboard.layerToggle") });
    // The toggle reads "123" on the letters layer and "abc" on the digits one.
    const onDigits = toggle.textContent === "abc";
    if (/[0-9+]/.test(key) !== onDigits) await userEvent.click(toggle);
    await userEvent.click(keyboard.getByRole("button", { name: key }));
  }
};

describe("CountryPickerSheet (UB5)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mockCapture.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("is a named modal dialog: the title, the search box, the X and the scrim", () => {
    mount();

    const dialog = screen.getByRole("dialog", { name: i18n.t("country.title") });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("textbox", { name: i18n.t("country.search") })).toHaveAttribute(
      "aria-readonly",
      "true"
    );
    expect(screen.getByTestId("country-sheet-close")).toHaveAccessibleName(i18n.t("language.close"));
    expect(screen.getByTestId("country-sheet-scrim")).toHaveAccessibleName(i18n.t("language.close"));
    // No flags: no image per row (a runtime flag CDN breaks offline).
    expect(within(screen.getByTestId("country-IN")).queryAllByRole("img")).toHaveLength(0);
  });

  it("239 rows from the SDK table: India (the default) first, then A→Z; no AQ / AX, one IL, no spaces", () => {
    mount();

    const list = rows();
    expect(list).toHaveLength(239);
    expect(list[0]).toHaveAttribute("data-testid", "country-IN");
    expect(list[0]).toHaveAttribute("aria-pressed", "true");
    expect(list[1]).toHaveAttribute("data-testid", "country-AF");
    expect(list[2]).toHaveAttribute("data-testid", "country-AL");
    expect(screen.queryByTestId("country-AQ")).toBeNull(); // dial code null
    expect(screen.queryByTestId("country-AX")).toBeNull(); // dial code ""
    expect(screen.getAllByTestId("country-IL")).toHaveLength(1); // listed twice
    for (const row of list) {
      expect(row.querySelector('[dir="ltr"]')?.textContent).toMatch(/^\+\d+$/);
      if (row.dataset.testid !== "country-IN") expect(row).toHaveAttribute("aria-pressed", "false");
    }
    // ≥ 96 px rows (Rule 4).
    expect(list[0].className).toContain("min-h-[96px]");
  });

  it("shows the four codes corrected at the SDK source, NANP spaces stripped", () => {
    mount();

    const dial = (code: string) =>
      screen.getByTestId(`country-${code}`).querySelector('[dir="ltr"]')?.textContent;
    expect(dial("CY")).toBe("+357");
    expect(dial("GY")).toBe("+592");
    expect(dial("KY")).toBe("+1345");
    expect(dial("KZ")).toBe("+7");
    expect(dial("PY")).toBe("+595");
  });

  it("the selected country leads the list (a guest who already picked)", () => {
    store.dispatch(setCountryCode({ code: "AE", dialCode: "+971", min: 9, max: 9, picked: true }));
    mount();

    expect(rows()[0]).toHaveAttribute("data-testid", "country-AE");
    expect(rows()[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("country-IN")).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["part of the name", "emir"],
    ["the dial digits", "971"],
    ["the dial code with its +", "+971"],
    ["the name, ignoring case and spaces", "unitedarab"],
  ])("search by %s (%s) finds the UAE", async (_label, query) => {
    mount();

    await type(query);

    expect(screen.getByTestId("country-search")).toHaveTextContent(query);
    expect(rows().map((row) => row.dataset.testid)).toEqual(["country-AE"]);
  });

  it("search ignores accents: 'cote' finds Côte d'Ivoire", async () => {
    mount();

    await type("cote");

    expect(rows().map((row) => row.dataset.testid)).toContain("country-CI");
  });

  it("no match names the query; CLEAR brings every row back", async () => {
    mount();

    await type("zzq");

    expect(rows()).toHaveLength(0);
    expect(screen.getByTestId("country-no-results")).toHaveTextContent(
      i18n.t("country.noResults", { query: "zzq" })
    );
    await userEvent.click(screen.getByRole("button", { name: i18n.t("keyboard.clear") }));
    expect(rows()).toHaveLength(239);
    expect(screen.getByTestId("country-search")).toHaveTextContent(i18n.t("country.search"));
  });

  it("a row tap stores the pick with picked:true, reports it and closes", async () => {
    const { onClose } = mount();

    await type("emir");
    await userEvent.click(screen.getByTestId("country-AE"));

    expect(country()).toEqual({ code: "AE", dialCode: "+971", min: 9, max: 9, picked: true });
    expect(mockCapture).toHaveBeenCalledWith("country_code_selected", {
      country_code: "AE",
      dial_code: "+971",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the scrim", "country-sheet-scrim"],
    ["the X", "country-sheet-close"],
  ])("%s closes without writing anything and reports the dismissal", async (_label, testId) => {
    const before = country();
    const { onClose } = mount();

    await userEvent.click(screen.getByTestId(testId));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(country()).toEqual(before);
    expect(mockCapture).toHaveBeenCalledWith("country_code_selection_dismissed", {});
    expect(mockCapture).not.toHaveBeenCalledWith("country_code_selected", expect.anything());
  });

  it("Arabic: localized labels with الهند first, isolated; Latin search still finds the UAE", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    mount();

    expect(screen.getByRole("dialog", { name: i18n.t("country.title") })).toBeInTheDocument();
    const first = rows()[0];
    expect(first).toHaveAttribute("data-testid", "country-IN");
    const leaf = first.querySelector('[dir="auto"]') as HTMLElement;
    const label = leaf.textContent ?? "";
    expect(label).toContain("الهند");
    // FSI … PDI around the name (the RTL isolate rule).
    expect(label.startsWith("⁨")).toBe(true);
    expect(label.endsWith("⁩")).toBe(true);
    // Fixer UI-3 (P9f S2): a shrink-to-fit leaf in the name slot, so the
    // Arabic name keeps the list's left edge; the search box (Latin input)
    // never resolves its Arabic placeholder RTL. Geometry: countryCode.spec.
    expect(leaf).toHaveClass("w-fit", "max-w-full");
    expect(leaf.parentElement).toHaveClass("min-w-0", "flex-1");
    expect(screen.getByTestId("country-search")).not.toHaveAttribute("dir");

    await type("emir");
    expect(rows().map((row) => row.dataset.testid)).toEqual(["country-AE"]);
  });

  it("Arabic order: after the selected India the rows follow ARABIC collation of the Arabic names — not the English list order", async () => {
    const order = () => rows().map((row) => row.dataset.testid);
    const { unmount } = render(
      <Provider store={store}>
        <CountryPickerSheet onClose={vi.fn()} />
      </Provider>
    );
    const english = order();
    unmount();
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    mount();

    const labels = rows()
      .slice(1)
      .map((row) => (row.querySelector('[dir="auto"]')?.textContent ?? "").replace(/[⁦-⁩]/g, ""));
    expect(labels).toHaveLength(238);
    expect(labels).toEqual([...labels].sort(new Intl.Collator("ar").compare));
    expect(order()[0]).toBe("country-IN");
    expect(order()).not.toEqual(english);
    expect([...order()].sort()).toEqual([...english].sort());
  });
});
