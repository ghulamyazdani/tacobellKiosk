import { describe, expect, it } from "vitest";
import { store } from "../store";
import { openConfigurationError } from "../../features/error/error.slice";

describe("kiosk store (createKioskStore wiring)", () => {
  it("registers the full posistKiosk reducer map (25 slices + api)", () => {
    const state = store.getState() as Record<string, unknown>;
    const expectedKeys = [
      "auth", "menu", "cart", "payment", "offer", "appSettings", "order",
      "menuSelections", "paymentInfo", "customerInfo", "appImage",
      "tableSummary", "pipeline", "theme", "multiLanguage", "timer",
      "makeItAMeal", "errorInfo", "loyalty", "dynamicPricing",
      "messageModals", "autoUpdate", "recommendation", "kioskOpenStatus",
      "filter", "api",
    ];
    for (const key of expectedKeys) {
      expect(state, `missing slice "${key}"`).toHaveProperty(key);
    }
  });

  it("RESET_STATE returns every slice to its initial state", () => {
    store.dispatch(openConfigurationError({ message: "boom" }));
    let errorInfo = (store.getState() as { errorInfo: { configurationError: { isOpen: boolean } } }).errorInfo;
    expect(errorInfo.configurationError.isOpen).toBe(true);

    store.dispatch({ type: "RESET_STATE" });
    errorInfo = (store.getState() as { errorInfo: { configurationError: { isOpen: boolean } } }).errorInfo;
    expect(errorInfo.configurationError.isOpen).toBe(false);
  });
});
