import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { setTags } from "@cx-sdk/catalog/state/Menu.slice";
import {
  setHideFilter,
  setKioskSettings,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setFilters } from "@cx-sdk/catalog/state/filter.slice";
import { store } from "../../../redux/app/store";
import MenuFilterChips from "../MenuFilterChips";
import i18n from "../../../i18n";

/*
  audit-fixes U1 (PAR-05) — the VEG / NON-VEG chips under the rail's bell
  (design language, no frame). A chip shows only for a tag the menu carries,
  never under hide_filter or hide_veg_non_veg (re-checked: a stale tag list
  survives a menu without diet tags). One diet at a time; a re-tap clears.
  Seams: captureKioskEvent (asserted per event) and the store's filter slice.
*/

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: mocks.capture,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

const filters = () =>
  (store.getState() as unknown as { filter: { filters: string[] } }).filter.filters;

const chip = (tag: string) => screen.getByTestId(`menu-filter-${tag}`);

describe("MenuFilterChips (U1 — diet filter chips)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setTags({ tags: ["veg", "non-veg"] }));
    mocks.capture.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("off by default (user 2026-10-14: filters hidden for now) → no chip, even with both diet tags", () => {
    const { container } = render(<MenuFilterChips />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("off by default → a persisted pick is cleared, so the hidden filter never narrows the menu", () => {
    store.dispatch(setFilters(["veg"]));
    render(<MenuFilterChips />, { wrapper });
    expect(filters()).toEqual([]);
  });

  it("enabled → a pick is kept", () => {
    store.dispatch(setFilters(["veg"]));
    render(<MenuFilterChips enabled />, { wrapper });
    expect(filters()).toEqual(["veg"]);
  });

  it("no diet tag in the menu → nothing at all", () => {
    store.dispatch(setTags({ tags: ["spicy"] }));
    const { container } = render(<MenuFilterChips enabled />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("a menu without any tag list → nothing", () => {
    store.dispatch(setTags({ tags: undefined }));
    const { container } = render(<MenuFilterChips enabled />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("hide_filter → nothing", () => {
    store.dispatch(setHideFilter(true));
    const { container } = render(<MenuFilterChips enabled />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("hide_veg_non_veg → nothing, even with a stale diet tag list", () => {
    store.dispatch(setKioskSettings({ hide_veg_non_veg: true }));
    const { container } = render(<MenuFilterChips enabled />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("only the diet tags the menu carries get a chip, VEG first", () => {
    store.dispatch(setTags({ tags: ["spicy", "non-veg"] }));
    render(<MenuFilterChips enabled />, { wrapper });

    expect(screen.queryByTestId("menu-filter-veg")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.dataset.testid)).toEqual(["menu-filter-non-veg"]);
  });

  it("a named group of two toggle buttons, compressed (the rail's Cm Bd), 56 px, each with a decorative mark", () => {
    render(<MenuFilterChips enabled />, { wrapper });

    const group = screen.getByRole("group", { name: i18n.t("menu.filters") });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.dataset.testid)).toEqual(["menu-filter-veg", "menu-filter-non-veg"]);
    for (const button of buttons) {
      expect(group).toContainElement(button);
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("aria-pressed", "false");
      expect(button).toHaveClass("tb-compressed", "w-full", "border-2", "border-tb-purple", "text-tb-purple");
      expect(button).not.toHaveClass("bg-tb-purple");
      // Rule 4: the touch target is at least 44 px tall.
      const height = Number(/(?:^|\s)h-\[(\d+)px\]/.exec(button.className)?.[1]);
      expect(height).toBeGreaterThanOrEqual(44);
    }
    expect(chip("veg")).toHaveAccessibleName(i18n.t("menu.veg"));
    expect(chip("non-veg")).toHaveAccessibleName(i18n.t("menu.nonVeg"));
    // The mark repeats the label: hidden from assistive tech, no text node.
    const mark = chip("veg").querySelector('[data-testid="veg-mark-veg"]');
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).not.toHaveAttribute("role");
    expect(mark?.textContent).toBe("");
    expect(chip("non-veg").querySelector('[data-testid="veg-mark-non-veg"]')).not.toBeNull();
  });

  it("VEG → ['veg'], pressed, filterApplied {tag_count, tags}, and the menu is told", () => {
    const onChange = vi.fn();
    render(<MenuFilterChips enabled onChange={onChange} />, { wrapper });

    fireEvent.click(chip("veg"));

    expect(filters()).toEqual(["veg"]);
    expect(chip("veg")).toHaveAttribute("aria-pressed", "true");
    expect(chip("veg")).toHaveClass("bg-tb-purple", "text-tb-surface");
    expect(chip("non-veg")).toHaveAttribute("aria-pressed", "false");
    expect(mocks.capture).toHaveBeenCalledWith("filter_applied", { tag_count: 1, tags: ["veg"] });
    expect(mocks.capture).not.toHaveBeenCalledWith("filter_removed", expect.anything());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("NON-VEG while VEG is on swaps (one diet at a time)", () => {
    store.dispatch(setFilters(["veg"]));
    render(<MenuFilterChips enabled />, { wrapper });

    fireEvent.click(chip("non-veg"));

    expect(filters()).toEqual(["non-veg"]);
    expect(chip("non-veg")).toHaveAttribute("aria-pressed", "true");
    expect(chip("veg")).toHaveAttribute("aria-pressed", "false");
    expect(mocks.capture).toHaveBeenCalledWith("filter_applied", { tag_count: 1, tags: ["non-veg"] });
  });

  it("a re-tap clears the filter: [] and filterRemoved {previous_tag_count}", () => {
    const onChange = vi.fn();
    store.dispatch(setFilters(["non-veg"]));
    render(<MenuFilterChips enabled onChange={onChange} />, { wrapper });

    fireEvent.click(chip("non-veg"));

    expect(filters()).toEqual([]);
    expect(chip("non-veg")).toHaveAttribute("aria-pressed", "false");
    expect(mocks.capture).toHaveBeenCalledWith("filter_removed", { previous_tag_count: 1 });
    expect(mocks.capture).not.toHaveBeenCalledWith("filter_applied", expect.anything());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("Arabic: the group and the chips speak the guest's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(<MenuFilterChips enabled />, { wrapper });

    expect(screen.getByRole("group", { name: i18n.t("menu.filters") })).toBeInTheDocument();
    expect(chip("veg")).toHaveTextContent(i18n.t("menu.veg"), { normalizeWhitespace: false });
    expect(chip("non-veg")).toHaveTextContent(i18n.t("menu.nonVeg"), { normalizeWhitespace: false });
    expect(chip("veg")).not.toHaveTextContent("Veg");
  });
});
