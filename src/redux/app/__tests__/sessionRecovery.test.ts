import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../models/db", () => ({
  resetDatabase: vi.fn(),
}));

import {
  recoverFromAuthFailure,
  recoverFromServerError,
} from "../sessionRecovery";
import { resetDatabase } from "../../../models/db";

describe("sessionRecovery (401 vs 504/505 — deliberately asymmetric)", () => {
  const dispatched: Array<{ type: string }> = [];
  const dispatch = (action: { type: string }) => {
    dispatched.push(action);
    return action;
  };

  beforeEach(() => {
    dispatched.length = 0;
    vi.clearAllMocks();
    window.localStorage.setItem("probe", "1");
  });

  it("401 path: logout + RESET_STATE + full storage & Dexie teardown", () => {
    recoverFromAuthFailure(dispatch);
    const types = dispatched.map((a) => a.type);
    expect(types).toContain("auth/setLogOut");
    expect(types).toContain("RESET_STATE");
    expect(window.localStorage.getItem("probe")).toBeNull();
    expect(resetDatabase).toHaveBeenCalledTimes(1);
  });

  it("504/505 path: slice-by-slice empties then RESET_STATE, no storage wipe", () => {
    recoverFromServerError(dispatch);
    const types = dispatched.map((a) => a.type);
    // Exact sequence parity with posistKiosk's recovery block.
    expect(types).toEqual([
      "auth/setLogOut",
      "order/emptyOrder",
      "menu/emptyMenuData",
      "cart/emptyCart",
      "cart/emptyCart",
      "filter/clearFilters",
      "cart/removeCartOffer",
      "customerInfo/removeCustomerDetails",
      "multiLanguage/emptySelectedLanguage",
      "appSettings/clearTent",
      "menuSelections/closeBottomSheet",
      "RESET_STATE",
    ]);
    // 504/505 must NOT clear web storage (that is the 401 path's job).
    expect(window.localStorage.getItem("probe")).toBe("1");
    expect(resetDatabase).not.toHaveBeenCalled();
  });
});
