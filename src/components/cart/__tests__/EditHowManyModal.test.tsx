import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import EditHowManyModal from "../EditHowManyModal";
import i18n, { isolate } from "../../../i18n";

/*
  Item 20's numpad (Figma 1:4460): a dialog named by its title and copy that
  takes focus on EDIT, and a k that never passes the row's N (D6).
*/
const ROW = { id: "cheese-burger", itemId: "cb-1", name: "Cheese Burger", quantity: 3 };

const renderModal = () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <Provider store={store}>
      <EditHowManyModal row={ROW} onCancel={onCancel} onConfirm={onConfirm} />
    </Provider>,
  );
  return { onConfirm, onCancel };
};

describe("EditHowManyModal (item 20, 1:4460)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("is a modal dialog named by its title and copy, with focus on EDIT", () => {
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "You have 3 Cheese Burger" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Choose how many you want to edit:");
    expect(screen.getByTestId("edit-how-many-confirm")).toHaveFocus();
  });

  it("k never passes N, and EDIT is inert at 0", async () => {
    const { onConfirm } = renderModal();
    await userEvent.click(screen.getByTestId("edit-how-many-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("numpad-key-7"));
    expect(screen.getByTestId("edit-how-many-value")).toHaveTextContent("0");
    for (let i = 0; i < 5; i++) await userEvent.click(screen.getByTestId("edit-how-many-increase"));
    expect(screen.getByTestId("edit-how-many-value")).toHaveTextContent("3");

    await userEvent.click(screen.getByTestId("edit-how-many-decrease"));
    await userEvent.click(screen.getByTestId("edit-how-many-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(2);
  });
});

/*
  Test-author additions (lane bag-pdp, item 20): the 0…N value rules, the
  numpad, the exits, touch targets, the ADA cap and the Arabic title.
*/
describe("EditHowManyModal — value, keys, exits, layout (item 20)", () => {
  const setup = (quantity: unknown) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <Provider store={store}>
        <EditHowManyModal row={{ ...ROW, quantity }} onCancel={onCancel} onConfirm={onConfirm} />
      </Provider>,
    );
    const value = () => screen.getByTestId("edit-how-many-value").textContent;
    const key = (k: string) => fireEvent.click(screen.getByTestId(`numpad-key-${k}`));
    const confirm = () => screen.getByTestId("edit-how-many-confirm");
    return { onConfirm, onCancel, value, key, confirm };
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("starts at 0 with EDIT aria-disabled (and dimmed); any k > 0 enables it", () => {
    const { value, key, confirm } = setup(3);
    expect(value()).toBe("0");
    expect(confirm()).toHaveAttribute("aria-disabled", "true");
    expect(confirm()).toHaveClass("opacity-40");
    key("1");
    expect(confirm()).toHaveAttribute("aria-disabled", "false");
    expect(confirm()).not.toHaveClass("opacity-40");
  });

  it("the − / + pill clamps to [0, N]", () => {
    const { value } = setup(2);
    fireEvent.click(screen.getByTestId("edit-how-many-decrease"));
    expect(value()).toBe("0");
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByTestId("edit-how-many-increase"));
    expect(value()).toBe("2");
    fireEvent.click(screen.getByTestId("edit-how-many-decrease"));
    fireEvent.click(screen.getByTestId("edit-how-many-decrease"));
    fireEvent.click(screen.getByTestId("edit-how-many-decrease"));
    expect(value()).toBe("0");
  });

  it("numpad (N = 12): a key that would pass N is ignored; digits never exceed N's length", () => {
    const { value, key } = setup(12);
    key("5");
    key("3"); // 53 > 12
    expect(value()).toBe("5");
    key("0"); // 50 > 12
    expect(value()).toBe("5");
    fireEvent.click(screen.getByTestId("numpad-backspace"));
    key("1");
    key("2");
    expect(value()).toBe("12");
    key("1"); // a third digit: KioskNumpad's maxLength
    expect(value()).toBe("12");
    key("0");
    expect(value()).toBe("12");
  });

  it("leading zeros are normalised away; a one-digit N still takes its first key", () => {
    const { value, key } = setup(9);
    key("0");
    expect(value()).toBe("0");
    key("0");
    key("7");
    expect(value()).toBe("7");
    key("8"); // a second digit can never fit a one-digit N
    expect(value()).toBe("7");
  });

  it("CLEAR empties to 0 and backspace drops the last digit", () => {
    const { value, key, confirm } = setup(12);
    key("1");
    key("1");
    expect(value()).toBe("11");
    fireEvent.click(screen.getByTestId("numpad-backspace"));
    expect(value()).toBe("1");
    fireEvent.click(screen.getByTestId("numpad-clear"));
    expect(value()).toBe("0");
    expect(confirm()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("numpad-backspace")); // backspace on empty stays 0
    expect(value()).toBe("0");
  });

  it("EDIT confirms exactly k — from the numpad or the pill, up to N itself", () => {
    const { onConfirm, key, confirm } = setup(12);
    fireEvent.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
    key("1");
    key("2");
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenLastCalledWith(12);
    fireEvent.click(screen.getByTestId("edit-how-many-decrease"));
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenLastCalledWith(11);
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("the X and the scrim both cancel; neither confirms", () => {
    const { onCancel, onConfirm, key } = setup(3);
    key("2");
    fireEvent.click(screen.getByTestId("edit-how-many-close"));
    const scrim = screen
      .getAllByRole("button", { name: i18n.t("language.close") })
      .find((button) => button.getAttribute("data-testid") === null);
    expect(scrim).toBeDefined();
    fireEvent.click(scrim as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("an unreadable quantity reads as 0: nothing can be confirmed", () => {
    const { value, key, confirm, onConfirm } = setup("lots");
    key("1");
    fireEvent.click(screen.getByTestId("edit-how-many-increase"));
    expect(value()).toBe("0");
    fireEvent.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("touch targets are ≥ 44 px (pill 44, X 48, EDIT 96, numpad keys ≥ 44)", () => {
    setup(3);
    for (const id of ["edit-how-many-decrease", "edit-how-many-increase"]) {
      expect(screen.getByTestId(id)).toHaveClass("h-[44px]", "w-[44px]");
    }
    expect(screen.getByTestId("edit-how-many-close")).toHaveClass("h-[48px]", "w-[48px]");
    expect(screen.getByTestId("edit-how-many-confirm")).toHaveClass("h-[96px]", "w-full");
    for (const id of ["numpad-key-0", "numpad-clear", "numpad-backspace"]) {
      expect(screen.getByTestId(id)).toHaveClass("min-h-[44px]", "min-w-[44px]");
    }
  });

  it("ADA: the card is capped by the bag (100% − 96 px); only the copy + picker scroll — X and EDIT never do", () => {
    setup(3);
    const dialog = screen.getByTestId("edit-how-many");
    expect(dialog).toHaveClass("absolute", "inset-0", "z-50");
    const card = screen.getByTestId("edit-how-many-confirm").closest('[class*="max-h-[calc(100%_-_96px)]"]');
    expect(card).not.toBeNull();
    expect(card).toHaveClass("overflow-hidden", "flex-col");
    for (const id of ["edit-how-many-confirm", "edit-how-many-close"]) {
      expect(screen.getByTestId(id).closest(".overflow-y-auto")).toBeNull();
    }
    for (const id of ["edit-how-many-value", "kiosk-numpad"]) {
      expect(screen.getByTestId(id).closest(".overflow-y-auto")).not.toBeNull();
    }
  });

  it("Arabic: the title names the item by its Arabic alias, in the Arabic copy", async () => {
    const AR_NAME = "تشيز برجر";
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(
      <Provider store={store}>
        <EditHowManyModal
          row={{ ...ROW, aliases: [{ value: AR_NAME, name: "Arabic", code: "ar" }] }}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </Provider>,
    );
    const title = document.getElementById("edit-how-many-title")?.textContent;
    expect(title).toBe(i18n.t("bag.editHowMany.title", { qty: 3, name: isolate(AR_NAME) }));
    expect(title).toContain(AR_NAME);
    expect(title).not.toContain("Cheese Burger");
    expect(document.getElementById("edit-how-many-body")?.textContent).toBe(i18n.t("bag.editHowMany.body"));
  });
});
