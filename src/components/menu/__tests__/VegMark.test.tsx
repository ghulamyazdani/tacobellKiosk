import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import VegMark, { vegTypeOf } from "../VegMark";
import i18n from "../../../i18n";

/*
  audit-fixes U1 — the shared diet mark every surface imports (menu cards,
  the PDP, bag rows, the filter chips). Tri-state, hidden by the operator's
  hide_veg_non_veg, labelled for screen readers, and never a text node (the
  e2e suite reads the menu card's price <p> as text: /^₹\d/).
*/

const VEG = { id: "bean", tags: ["veg"] };
const NON_VEG = { id: "chicken", tags: ["non-veg"] };
const UNTAGGED = { id: "cola", tags: ["drinks"] };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

describe("vegTypeOf", () => {
  it.each([
    [VEG, "veg"],
    [NON_VEG, "non-veg"],
    [UNTAGGED, null],
    [{ tags: [] }, null],
    [{ id: "no-tags" }, null],
    [{ tags: "veg" }, null],
    [null, null],
    [undefined, null],
    ["veg", null],
  ])("%j → %s", (entity, expected) => {
    expect(vegTypeOf(entity)).toBe(expected);
  });

  it("a VARIANT row reads its selectedVariant.tags over its own", () => {
    expect(
      vegTypeOf({ type: "VARIANT", tags: ["veg"], selectedVariant: { tags: ["non-veg"] } }),
    ).toBe("non-veg");
    expect(
      vegTypeOf({ type: "VARIANT", tags: ["non-veg"], selectedVariant: { tags: ["veg"] } }),
    ).toBe("veg");
    // No variant tag list → the row's own tags.
    expect(vegTypeOf({ type: "VARIANT", tags: ["veg"], selectedVariant: {} })).toBe("veg");
    // Only VARIANT rows look at the variant.
    expect(
      vegTypeOf({ type: "ITEM", tags: ["veg"], selectedVariant: { tags: ["non-veg"] } }),
    ).toBe("veg");
  });
});

describe("VegMark", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("veg: a labelled image with a dot, sized by `size` (default 20)", () => {
    render(<VegMark entity={VEG} />, { wrapper });

    const mark = screen.getByRole("img", { name: i18n.t("menu.veg") });
    expect(mark).toHaveAttribute("data-testid", "veg-mark-veg");
    expect(mark).toHaveClass("border-tb-veg", "pointer-events-none", "shrink-0");
    expect(mark).toHaveStyle({ width: "20px", height: "20px" });
    expect(mark.firstElementChild).toHaveClass("rounded-full", "bg-tb-veg");
  });

  it("non-veg: a labelled image with a triangle", () => {
    render(<VegMark entity={NON_VEG} size={24} />, { wrapper });

    const mark = screen.getByRole("img", { name: i18n.t("menu.nonVeg") });
    expect(mark).toHaveAttribute("data-testid", "veg-mark-non-veg");
    expect(mark).toHaveClass("border-tb-non-veg");
    expect(mark).toHaveStyle({ width: "24px", height: "24px" });
    expect(mark.firstElementChild).toHaveClass("bg-tb-non-veg");
    expect(mark.firstElementChild?.className).toContain("clip-path:polygon");
  });

  it("an untagged entity renders nothing", () => {
    const { container } = render(<VegMark entity={UNTAGGED} />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("the operator's hide_veg_non_veg hides every mark", () => {
    store.dispatch(setKioskSettings({ hide_veg_non_veg: true }));
    const { container } = render(
      <>
        <VegMark entity={VEG} />
        <VegMark entity={NON_VEG} />
      </>,
      { wrapper },
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("a VARIANT row's selectedVariant.tags wins", () => {
    render(
      <VegMark entity={{ type: "VARIANT", tags: ["veg"], selectedVariant: { tags: ["non-veg"] } }} />,
      { wrapper },
    );
    expect(screen.getByTestId("veg-mark-non-veg")).toBeInTheDocument();
    expect(screen.queryByTestId("veg-mark-veg")).toBeNull();
  });

  it("decorative: hidden from assistive tech, no role, no label", () => {
    render(<VegMark entity={VEG} decorative />, { wrapper });

    const mark = screen.getByTestId("veg-mark-veg");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).not.toHaveAttribute("role");
    expect(mark).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("carries no text node (the price line stays /^₹\\d/)", () => {
    render(
      <>
        <VegMark entity={VEG} />
        <VegMark entity={NON_VEG} />
      </>,
      { wrapper },
    );
    for (const mark of [screen.getByTestId("veg-mark-veg"), screen.getByTestId("veg-mark-non-veg")]) {
      expect(mark.textContent).toBe("");
    }
  });

  it("Arabic: the label is the translated copy", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(
      <>
        <VegMark entity={VEG} />
        <VegMark entity={NON_VEG} />
      </>,
      { wrapper },
    );

    expect(screen.getByRole("img", { name: i18n.t("menu.veg") })).toHaveAttribute(
      "data-testid",
      "veg-mark-veg",
    );
    expect(screen.getByRole("img", { name: i18n.t("menu.nonVeg") })).toHaveAttribute(
      "data-testid",
      "veg-mark-non-veg",
    );
    expect(i18n.t("menu.veg")).toContain("نباتي");
  });
});
