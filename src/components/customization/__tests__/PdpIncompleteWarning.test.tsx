import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import PdpIncompleteWarning from "../PdpIncompleteWarning";
import i18n from "../../../i18n";

/*
  Item 23's completion warning (lazy since the fixer pass — D7): it names
  every group the commit's own first-failure scans reject, and shows nothing
  when none is (a rejected split edit fails with every group done).
*/
const GROUPS: Record<string, Record<string, unknown>> = {
  box_1_combo: { _id: "box_1_combo", name: "Nuggets", min: 1, max: 1 },
  drink_addons: { _id: "drink_addons", name: "Drink", min: 1, max: 1 },
  sauce_addons: { _id: "sauce_addons", name: "Sauce", min: 0, max: 2 },
};
const fetchModifierProperties = (ids: unknown[]) => ids.map((id) => GROUPS[String(id)]);
const isBox = (group: unknown) =>
  String((group as { _id?: unknown } | null)?._id ?? "").includes("_combo");

const renderWarning = (customizations: Record<string, unknown[]>) => {
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <PdpIncompleteWarning
        entity={{ modifiers: Object.keys(GROUPS) }}
        selectedVariant={{}}
        customizations={customizations}
        fetchModifierProperties={fetchModifierProperties}
        isBox={isBox}
        onClose={onClose}
      />
    </Provider>,
  );
  return onClose;
};

describe("PdpIncompleteWarning (item 23)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("names every incomplete group, in scan order, with the box title; GOT IT closes", async () => {
    const onClose = renderWarning({ box_1_combo: [], drink_addons: [], sauce_addons: [] });

    const dialog = screen.getByRole("alertdialog", { name: "Let's finish building your box first" });
    expect(dialog).toHaveAccessibleDescription(
      "Please choose your nuggets and drink before adding to your bag",
    );
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("pdp-incomplete-gotit"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when every group is complete", () => {
    const onClose = renderWarning({
      box_1_combo: [{ id: "n6", quantity: 1 }],
      drink_addons: [{ id: "cola", quantity: 1 }],
      sauce_addons: [],
    });

    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/*
  audit-fixes UB2: ADD TO BAG before a size is picked — the PDP passes
  `sizeMissing` and the warning names the size (lazy key pdp.incomplete.size),
  whatever the groups say; the item title, never the box one, for a plain
  sized item.
*/
describe("PdpIncompleteWarning — sizeMissing (UB2)", () => {
  const renderSizeWarning = () =>
    render(
      <Provider store={store}>
        <PdpIncompleteWarning
          entity={{ hasVariant: true }}
          selectedVariant={{}}
          customizations={{}}
          fetchModifierProperties={fetchModifierProperties}
          isBox={isBox}
          sizeMissing
          onClose={vi.fn()}
        />
      </Provider>,
    );

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("EN: 'Let's finish your choices first' / 'Please choose your size before adding to your bag'", () => {
    renderSizeWarning();

    const dialog = screen.getByRole("alertdialog", { name: "Let's finish your choices first" });
    expect(dialog).toHaveAccessibleDescription("Please choose your size before adding to your bag");
    expect(screen.getByTestId("pdp-incomplete-gotit")).toHaveTextContent(i18n.t("offers.gotIt"));
  });

  it("without sizeMissing the same empty-variant PDP shows nothing (the old dead end is the PDP's job now)", () => {
    render(
      <Provider store={store}>
        <PdpIncompleteWarning
          entity={{ hasVariant: true }}
          selectedVariant={{}}
          customizations={{}}
          fetchModifierProperties={fetchModifierProperties}
          isBox={isBox}
          onClose={vi.fn()}
        />
      </Provider>,
    );
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
  });

  it("AR: the Arabic title and body, naming the size in Arabic", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderSizeWarning();

    const size = i18n.t("pdp.incomplete.size");
    expect(size).toContain("الحجم");
    expect(document.getElementById("pdp-incomplete-title")?.textContent).toBe(
      i18n.t("pdp.incomplete.titleItem"),
    );
    expect(document.getElementById("pdp-incomplete-message")?.textContent).toBe(
      i18n.t("pdp.incomplete.body", { groups: size.toLocaleLowerCase("ar") }),
    );
    expect(document.getElementById("pdp-incomplete-message")?.textContent).toContain("الحجم");
    expect(document.getElementById("pdp-incomplete-message")?.textContent).not.toMatch(/size/i);
  });
});
