import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import PdpIncompleteWarning from "../PdpIncompleteWarning";
import "../../../i18n";

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
