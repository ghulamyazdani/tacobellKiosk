/* eslint-disable @typescript-eslint/no-explicit-any --
 * Store reads mirror the untyped legacy slices the reset touches; typed in
 * the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setCartItems,
  setCartInstructions,
} from "@cx-sdk/ordering/state/cart.slice";
import {
  openMakeItAMealSession,
  makeItAMealIsSessionOpen,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import {
  setShowErrorModalGlobal,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { startTimer, tick } from "@cx-sdk/core/session/timer.slice";
import { store } from "../../../redux/app/store";
import useSessionReset, { type SessionResetScope } from "../useSessionReset";
import "../../../i18n";

/** Minimal harness — the hook under test needs a real store dispatch only. */
function Harness({ scope }: { scope: SessionResetScope }) {
  const { resetSession } = useSessionReset();
  return (
    <button
      type="button"
      data-testid="fire-reset"
      onClick={() => resetSession(scope)}
    >
      reset
    </button>
  );
}

const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  name: "Cheese Burger",
  quantity: 2,
  type: "CUSTOMIZABLE",
  total_price: 8.6,
  customizations: {},
};

const MENU_FIXTURE = { categories: [{ id: "c1", name: "Sides" }] };

const seedCustomerSession = () => {
  store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  store.dispatch(setCartInstructions("no onions"));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(setMenuData({ menu: MENU_FIXTURE }));
  store.dispatch(startTimer());
  store.dispatch(tick()); // 135 → 134, so the reset's stopTimer is observable
};

const fireReset = async (scope: SessionResetScope) => {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <Harness scope={scope} />
      </MemoryRouter>
    </Provider>
  );
  await userEvent.click(screen.getByTestId("fire-reset"));
};

const state = () => store.getState() as any;

describe("useSessionReset (contract C2 — the canonical session reset)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it('resetSession("full") clears cart, MIAM session, instructions, menu and timer', async () => {
    seedCustomerSession();
    // Sanity: the seed took.
    expect(state().cart.cartItems).toHaveLength(1);
    expect(state().cart.totalQuantity).toBe(2);
    expect(state().cart.instructions).toBe("no onions");
    expect(makeItAMealIsSessionOpen(state())).toBe(true);
    expect(state().menu.menu.categories).toHaveLength(1);
    expect(state().timer.timeRemaining).toBe(134);

    await fireReset("full");

    expect(state().cart.cartItems).toEqual([]);
    expect(state().cart.totalQuantity).toBe(0);
    expect(state().cart.subTotal).toBe(0);
    expect(state().cart.netAmount).toBe(0);
    expect(state().cart.instructions).toBe("");
    // The repeat sheet must not greet the next customer either.
    expect(state().cart.repeatItembottomSheet.isOpen).toBe(false);
    expect(makeItAMealIsSessionOpen(state())).toBe(false);
    // Full scope also drops the menu (the loaders refetch it right after).
    expect(state().menu.menu).toEqual({});
    // stopTimer: isRunning false, timeRemaining back at its 135 baseline.
    expect(state().timer.isRunning).toBe(false);
    expect(state().timer.timeRemaining).toBe(135);
  });

  it('resetSession("nextCustomer") clears the customer state but KEEPS the menu (fast path)', async () => {
    seedCustomerSession();
    await fireReset("nextCustomer");

    expect(state().cart.cartItems).toEqual([]);
    expect(state().cart.totalQuantity).toBe(0);
    expect(state().cart.instructions).toBe("");
    expect(makeItAMealIsSessionOpen(state())).toBe(false);
    // That is the point of the fast path: menu data survives.
    expect(state().menu.menu.categories).toHaveLength(1);
    expect(state().timer.isRunning).toBe(false);
    expect(state().timer.timeRemaining).toBe(135);
  });

  it.each<SessionResetScope>(["full", "nextCustomer"])(
    'resetSession("%s") clears the global error — it is redux, not page state',
    async (scope) => {
      store.dispatch(
        setShowErrorModalGlobal({ showErrorModal: true, errorMessage: "Checkout failed" })
      );

      await fireReset(scope);

      // Left set, the next customer's /menu opens on this customer's error.
      expect(state().appSettings.showGlobalError).toBe(false);
      expect(state().appSettings.errorMessageGlobal).toBe("");
    }
  );

  /*
    P9c: the ADA view is the guest's, so the splash's full reset ends it.
    The nextCustomer fast path ("Place new order") keeps it ON — fork parity,
    flagged for sign-off; changing it is a session-reset decision, so this
    pins it until someone makes that call deliberately.
  */
  it.each<[SessionResetScope, string, boolean]>([
    ["full", "OFF", false],
    ["nextCustomer", "ON (fork parity)", true],
  ])('resetSession("%s") leaves the ADA view %s', async (scope, _label, stillOn) => {
    store.dispatch(toggleAccessibilityMode());

    await fireReset(scope);

    expect(state().appSettings.accessibilityMode).toBe(stillOn);
  });

  it("is idempotent: resetting an already-clean session neither throws nor dirties state", async () => {
    await fireReset("full");
    expect(state().cart.cartItems).toEqual([]);
    expect(state().cart.totalQuantity).toBe(0);
    expect(makeItAMealIsSessionOpen(state())).toBe(false);
  });
});
