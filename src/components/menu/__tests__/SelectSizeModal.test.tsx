import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
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
