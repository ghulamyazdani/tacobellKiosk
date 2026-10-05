import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { store } from "../../../redux/app/store";
import KioskNumpad from "../KioskNumpad";
import "../../../i18n";

/**
 * P7c decision 2 — the ONE shared numeric keypad (Figma "Rewards / enter
 * code" 1:4174) behind both the loyalty phone entry and the 4-digit OTP step.
 * Controlled component: it owns no value, so every assertion here is about
 * what it hands back through `onChange` / `onSubmit`.
 */
const renderPad = (
  value: string,
  overrides: { maxLength?: number; onSubmit?: () => void } = {}
) => {
  const onChange = vi.fn();
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/phone"]}>
        <KioskNumpad value={value} onChange={onChange} {...overrides} />
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onChange };
};

describe("KioskNumpad (Figma 1:4174 — loyalty numeric keypad)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("renders 0-9, CLEAR and backspace — and NO GO key without onSubmit", () => {
    renderPad("");
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(screen.getByTestId(`numpad-key-${digit}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("numpad-clear")).toBeInTheDocument();
    expect(screen.getByTestId("numpad-backspace")).toBeInTheDocument();
    // Both loyalty consumers own their own CTA bar, so the extra GO row must
    // stay out of the Figma bottom row (CLEAR / 0 / backspace).
    expect(screen.queryByTestId("numpad-go")).not.toBeInTheDocument();
  });

  it("a digit APPENDS to the current value (never replaces it)", async () => {
    const { onChange } = renderPad("995");
    await userEvent.click(screen.getByTestId("numpad-key-3"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("9953");
  });

  it("0 is a real digit key, not a special key", async () => {
    const { onChange } = renderPad("1");
    await userEvent.click(screen.getByTestId("numpad-key-0"));
    expect(onChange).toHaveBeenCalledWith("10");
  });

  it("blocks input at maxLength but still allows backspace (OTP length 4)", async () => {
    const { onChange } = renderPad("1234", { maxLength: 4 });
    await userEvent.click(screen.getByTestId("numpad-key-5"));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("numpad-backspace"));
    expect(onChange).toHaveBeenCalledWith("123");
  });

  it("CLEAR empties the whole entry in one tap", async () => {
    const { onChange } = renderPad("9953833675");
    await userEvent.click(screen.getByTestId("numpad-clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("backspace on an empty entry is a safe no-op value (never undefined)", async () => {
    const { onChange } = renderPad("");
    await userEvent.click(screen.getByTestId("numpad-backspace"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("with onSubmit wired the GO key renders and fires it once", async () => {
    const onSubmit = vi.fn();
    renderPad("1234", { maxLength: 4, onSubmit });
    const go = screen.getByTestId("numpad-go");
    expect(go).toBeInTheDocument();
    await userEvent.click(go);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("every key carries the 44px kiosk touch-target floor (Rule 4)", () => {
    renderPad("", { onSubmit: vi.fn() });
    for (const id of [
      "numpad-key-1",
      "numpad-key-0",
      "numpad-clear",
      "numpad-backspace",
      "numpad-go",
    ]) {
      expect(screen.getByTestId(id).className).toContain("min-h-[44px]");
    }
  });
});
