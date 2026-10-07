import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  confirmTier1CustomizationRemoval,
  selectConfirmTier1CustomizationRemoval,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { store } from "../../../redux/app/store";
import {
  selectOrderTypeSwitchNotice,
  setOrderTypeSwitchNotice,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import useSessionReset, { type SessionResetScope } from "../useSessionReset";

/*
  Lane bag-pdp (I5): both lane flags are customer-scoped — the order-type
  switch's removal notice names THIS customer's items, and a pending tier-1
  removal confirm (item 24) would pop over the next customer's PDP. Every
  reset scope clears both. (A new file: useSessionReset.test.tsx belongs to
  the P8b lane.)
*/

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);

describe("useSessionReset — the lane's customer-scoped flags", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it.each(["full", "nextCustomer"] as SessionResetScope[])(
    "%s: clears the order-type switch notice and the tier-1 removal flag",
    (scope) => {
      store.dispatch(setOrderTypeSwitchNotice({ removed: [{ id: "greek-salad", name: "Greek Salad" }] }));
      store.dispatch(confirmTier1CustomizationRemoval(true));
      expect(selectOrderTypeSwitchNotice(store.getState())).not.toBeNull();
      expect(selectConfirmTier1CustomizationRemoval(store.getState())).toBe(true);

      const { result } = renderHook(() => useSessionReset(), { wrapper });
      act(() => result.current.resetSession(scope));

      expect(selectOrderTypeSwitchNotice(store.getState())).toBeNull();
      expect(selectConfirmTier1CustomizationRemoval(store.getState())).toBe(false);
    },
  );

  it("the notice selector is null-safe on a store without the slice", () => {
    expect(selectOrderTypeSwitchNotice({})).toBeNull();
    expect(selectOrderTypeSwitchNotice({ menuSelections: {} })).toBeNull();
  });
});
