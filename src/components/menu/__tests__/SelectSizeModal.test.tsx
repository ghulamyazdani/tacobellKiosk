import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { setCurrency, toggleAccessibilityMode } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import SelectSizeModal from "../SelectSizeModal";
import i18n from "../../../i18n";

const ENTITY = {
  id: "combo1",
  name: "Beefy Fries Burrito Deluxe Box",
  variants: [
    { id: "v-large", name: "Large", price: 8.09, calorieCount: 1660, isActive: true },
    { id: "v-medium", name: "Medium", price: 7.09, calorieCount: 360, isActive: true },
    { id: "v-regular", name: "Regular", price: 5.59, calorieCount: 360, isActive: true },
  ],
};

const renderModal = (onContinue = vi.fn(), onClose = vi.fn()) => {
  render(
    <Provider store={store}>
      <SelectSizeModal entity={ENTITY} onClose={onClose} onContinue={onContinue} />
    </Provider>
  );
  return { onContinue, onClose };
};

describe("SelectSizeModal (Figma 1:5628)", () => {
  it("renders hero + tile variants with delta pricing vs the cheapest", () => {
    renderModal();
    expect(screen.getByTestId("size-v-large")).toHaveTextContent("Large");
    expect(screen.getByTestId("size-v-large")).toHaveTextContent("+");
    expect(screen.getByTestId("size-v-large")).toHaveTextContent("2.50");
    // Cheapest shows absolute price, not a delta.
    expect(screen.getByTestId("size-v-regular")).toHaveTextContent("5.59");
    expect(screen.getByTestId("size-v-regular")).not.toHaveTextContent("+5.59");
  });

  it("every price carries the deployment's symbol (UB1 — never a bare amount): '+£2.50' / '£5.59'", () => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    try {
      renderModal();
      expect(screen.getByTestId("size-v-large")).toHaveTextContent("+£2.50");
      expect(screen.getByTestId("size-v-regular")).toHaveTextContent("£5.59");
    } finally {
      store.dispatch({ type: "RESET_STATE" });
    }
  });

  it("CONTINUE stays disabled until a size is selected, then returns the variant", async () => {
    const { onContinue } = renderModal();
    const cont = screen.getByTestId("size-continue");
    expect(cont).toBeDisabled();
    await userEvent.click(screen.getByTestId("size-v-medium"));
    expect(cont).toBeEnabled();
    await userEvent.click(cont);
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "v-medium", name: "Medium" })
    );
  });

  it("ADA (P9c): capped by its containing block with CONTINUE pinned — only the size tiles scroll", () => {
    renderModal();
    const cont = screen.getByTestId("size-continue");

    expect(
      cont.closest('[class*="max-h-[min(1500px,calc(100%_-_48px))]"]')
    ).not.toBeNull();
    expect(cont.closest(".overflow-y-auto")).toBeNull();
    expect(screen.getByRole("heading").closest(".overflow-y-auto")).toBeNull();
    expect(
      screen.getByTestId("size-v-large").closest(".overflow-y-auto")
    ).not.toBeNull();
  });

  describe("calories go through t('pack.cal') (P9f)", () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    });

    it("EN is unchanged: '1660 Cal' on the hero, '360 Cal' on a tile", () => {
      renderModal();
      expect(screen.getByTestId("size-v-large")).toHaveTextContent("1660 Cal");
      expect(screen.getByTestId("size-v-medium")).toHaveTextContent("360 Cal");
    });

    it("AR renders the translated unit and never 'Cal'", async () => {
      await act(async () => {
        await i18n.changeLanguage("ar");
      });
      renderModal();

      const hero = screen.getByTestId("size-v-large");
      const tile = screen.getByTestId("size-v-medium");
      expect(hero).toHaveTextContent(i18n.t("pack.cal", { value: 1660 }));
      expect(tile).toHaveTextContent(i18n.t("pack.cal", { value: 360 }));
      expect(hero).not.toHaveTextContent("Cal");
      expect(tile).not.toHaveTextContent("Cal");
    });
  });
});

/*
  Lane figma-polish S2 — "Select a Size v2" 1:5701 (1:5683 complete / 1:5628
  incomplete): the 680 card, Exp Bl 32/32 title + Md 32/36 entity name, the
  48 px X at 25/25, 36 px radios (hero bottom-right, tiles top-right; a 1 px
  ring, or the purple fill + the exported check), text-left tiles, the
  632 × 60 CTA in Grey 3 while disabled, and BEST VALUE gated on data (D12).
*/
describe("SelectSizeModal — Figma 1:5701 geometry (S2)", () => {
  const radioOf = (testId: string) =>
    screen.getByTestId(testId).querySelector<HTMLElement>('span[aria-hidden].h-\\[36px\\]');
  const card = () => screen.getByTestId("select-size-modal").children[1] as HTMLElement;

  afterEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("the 680 card; the title and the entity name in the frame's type; the 48 px X at 25 / 25", async () => {
    const { onClose } = renderModal();

    expect(card()).toHaveClass("w-[680px]", "rounded-[16px]", "px-[24px]", "pb-[24px]", "gap-[75px]", "pt-[80px]");
    expect(screen.getByRole("heading", { level: 2, name: i18n.t("size.title") })).toHaveClass(
      "tb-display",
      "text-[32px]",
      "leading-[32px]",
      "tracking-[-1px]",
      "text-tb-purple"
    );
    expect(screen.getByText(ENTITY.name)).toHaveClass(
      "text-[32px]",
      "font-medium",
      "capitalize",
      "leading-[36px]",
      "tracking-[-1px]",
      "text-black"
    );
    const closeButtons = screen.getAllByRole("button", { name: i18n.t("language.close") });
    const x = closeButtons.find((button) => button.querySelector("img"));
    expect(x).toHaveClass("absolute", "right-[25px]", "top-[25px]", "h-[48px]", "w-[48px]");
    await userEvent.click(x as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("radios: 36 px, the hero's bottom-right, the tiles' top-right; default = a 1 px ring, active = the fill + the radio-check", async () => {
    renderModal();
    const hero = radioOf("size-v-large");
    const tile = radioOf("size-v-medium");

    expect(hero).toHaveClass("absolute", "bottom-[12px]", "right-[12px]", "h-[36px]", "w-[36px]", "rounded-full");
    expect(tile).toHaveClass("absolute", "right-[13px]", "top-[11px]", "h-[36px]", "w-[36px]", "rounded-full");
    for (const radio of [hero, tile]) {
      expect(radio).toHaveClass("border", "border-tb-purple");
      expect(radio).not.toHaveClass("bg-tb-purple");
      expect(radio?.querySelector("img")).toBeNull();
    }
    expect(screen.getByTestId("size-v-medium")).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByTestId("size-v-medium"));

    const active = radioOf("size-v-medium");
    expect(active).toHaveClass("bg-tb-purple");
    expect(active).not.toHaveClass("border");
    expect(active?.querySelector("img")?.getAttribute("src")).toContain("radio-check");
    expect(screen.getByTestId("size-v-medium")).toHaveAttribute("aria-pressed", "true");
    // Only the chosen size is filled.
    expect(radioOf("size-v-large")).not.toHaveClass("bg-tb-purple");
    expect(radioOf("size-v-regular")?.querySelector("img")).toBeNull();
  });

  it("tiles are text-left; the hero is the 504 × 453 arch", () => {
    renderModal();

    for (const id of ["size-v-medium", "size-v-regular"]) {
      expect(screen.getByTestId(id)).toHaveClass("text-left");
    }
    expect(screen.getByTestId("size-v-large")).toHaveClass("h-[453px]", "w-[504px]", "rounded-t-[500px]");
  });

  it("CTA 632 × 60 (full width of the 680 card's 24 px inset), rounded-4: Grey 3 AND disabled until a size is chosen", async () => {
    renderModal();
    const cta = screen.getByTestId("size-continue");

    expect(cta).toHaveClass("h-[60px]", "w-full", "rounded-[4px]", "tb-display", "text-[18px]", "leading-[16px]");
    expect(cta).toHaveClass("bg-tb-grey-3");
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute("disabled");

    await userEvent.click(screen.getByTestId("size-v-regular"));

    expect(cta).toBeEnabled();
    expect(cta).not.toHaveClass("bg-tb-grey-3");
    expect(cta).toHaveClass("bg-tb-purple");
  });

  it.each([
    ["no badges (today's data)", undefined, false],
    ["a NEW badge", [{ name: "NEW" }], false],
    ["a 'Best Value' badge", [{ name: "Best Value" }], true],
    ["a bare 'BEST VALUE' string badge", ["BEST VALUE"], true],
  ])("BEST VALUE with %s on the hero size: shown = %s", (_label, badges, shown) => {
    render(
      <Provider store={store}>
        <SelectSizeModal
          entity={{
            ...ENTITY,
            variants: [{ ...ENTITY.variants[0], ...(badges ? { badges } : {}) }, ...ENTITY.variants.slice(1)],
          }}
          onClose={vi.fn()}
          onContinue={vi.fn()}
        />
      </Provider>
    );

    const chip = screen.queryByTestId("size-best-value");
    if (shown) {
      expect(chip).toHaveTextContent(i18n.t("size.bestValue"));
      expect(screen.getByTestId("size-v-large")).toContainElement(chip);
    } else {
      expect(chip).not.toBeInTheDocument();
    }
  });

  it("a best-value badge on a TILE size never shows the chip (it belongs to the hero)", () => {
    render(
      <Provider store={store}>
        <SelectSizeModal
          entity={{
            ...ENTITY,
            variants: [ENTITY.variants[0], { ...ENTITY.variants[1], badges: [{ name: "Best Value" }] }, ENTITY.variants[2]],
          }}
          onClose={vi.fn()}
          onContinue={vi.fn()}
        />
      </Provider>
    );

    expect(screen.queryByTestId("size-best-value")).not.toBeInTheDocument();
  });

  it("the backdrop is still the FIRST child button; the header and the CTA are pinned, only the sizes scroll", () => {
    renderModal();
    const modal = screen.getByTestId("select-size-modal");
    const backdrop = modal.firstElementChild as HTMLElement;

    expect(backdrop.tagName).toBe("BUTTON");
    expect(backdrop).toHaveClass("absolute", "inset-0", "bg-tb-purple/80");
    expect(backdrop).toHaveAccessibleName(i18n.t("language.close"));

    const scroller = screen.getByTestId("size-v-large").closest(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller).toContainElement(screen.getByTestId("size-v-regular"));
    expect(scroller).not.toContainElement(screen.getByRole("heading", { level: 2 }));
    expect(scroller).not.toContainElement(screen.getByText(ENTITY.name));
    expect(scroller).not.toContainElement(screen.getByTestId("size-continue"));
    expect(screen.getByTestId("size-continue")).toHaveClass("shrink-0");
  });

  it("ADA (no frame, design language): pt 48 / gap 24 so the hero + one tile row fit the 1074 px reach-zone cap", () => {
    store.dispatch(toggleAccessibilityMode());
    renderModal();

    expect(card()).toHaveClass("gap-[24px]", "pt-[48px]");
    expect(card()).not.toHaveClass("gap-[75px]");
    expect(card()).not.toHaveClass("pt-[80px]");
    expect(card().className).toContain("max-h-[min(1500px,calc(100%_-_48px))]");
  });
});
