/* eslint-disable @typescript-eslint/no-explicit-any --
 * Deployment-settings and cart fixtures mirror the untyped SDK slices; typed
 * with those slices, not here. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setCurrency,
  setDeploymentInfo,
  setKioskSettings,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import PaymentSelection from "../index";
import i18n from "../../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n.

  Mocked, and only these:
  - useNavigate — the buffer ends in a navigation to /receipt, and Back has a
    two-way fan-out; both have to be assertable.
  - useOrderHook — usePayAtCounter (imported by this screen for beginCheckout /
    cancelCheckout) pulls the real order hook, which drags in RTK Query
    mutations, IndexedDB and a whole converted menu. The push itself has its
    own suite; here the spies exist to prove this screen pushes NOTHING.

  The COD gate, the label flip and the total all run through the REAL
  selectors and the REAL SDK `checkIfCODAvailable`, so a fixture written
  against the wrong key spelling fails instead of silently passing.

  ⛔ SAFETY: this file asserts the card tile is inert. If that tile ever grows
  a handler, "renders the card tile as an inert, non-interactive element"
  fails — that is the point of it.
*/

const mockNavigate = vi.fn();
const mockPushOrder = vi.fn();
const mockGenerateQROrderId = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/menuHooks/useOrderHook", () => ({
  default: () => ({
    pushOrder: (...args: unknown[]) => mockPushOrder(...args),
    generateQROrderId: (...args: unknown[]) => mockGenerateQROrderId(...args),
  }),
}));

const state = () => store.getState() as any;

/**
 * The deployment blob shape the SDK's `checkIfCODAvailable` reads:
 * `entity.label === "Disable COD for Kiosk"` matched against `tabs[].tabLabel`.
 * The e2e fixture carries the fork's `name`/`tabType` spellings alongside
 * these — the two implementations diverge (documented in the screen header),
 * and this suite pins the one the screen actually calls.
 */
const disableCodFor = (tabLabel: string) => [
  {
    label: "Disable COD for Kiosk",
    name: "disable_cod_kiosk",
    tabs: [{ tabLabel, tabType: tabLabel, selected: true }],
  },
];

const seedCart = (netAmount = 24.5) => {
  store.dispatch(
    setCartItems([
      {
        id: "crunchwrap",
        itemId: "cw-1",
        name: "Crunchwrap Supreme",
        quantity: 1,
        type: "ITEM",
        total_price: netAmount,
      },
    ])
  );
  store.dispatch(setAmount(netAmount));
};

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/payment"]}>
        <PaymentSelection />
      </MemoryRouter>
    </Provider>
  );

const tap = (testId: string) => {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const buffer = () => screen.queryByTestId("payment-buffer");

describe("PaymentSelection — HOW WOULD YOU LIKE TO PAY?", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockNavigate.mockReset();
    mockPushOrder.mockReset();
    mockGenerateQROrderId.mockReset();

    store.dispatch({ type: "RESET_STATE" });
    seedCart();
    store.dispatch(setTabType("table"));
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setKioskSettings({ skip_crm_page: false }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the COD gate", () => {
    it("shows the PAY AT COUNTER tile when COD is available", () => {
      mount();

      expect(screen.getByTestId("payment-screen")).toBeInTheDocument();
      expect(screen.getByTestId("payment-counter")).toBeInTheDocument();
      expect(screen.queryByTestId("payment-unavailable")).not.toBeInTheDocument();
    });

    it("shows the tile when the deployment says COD is off for ANOTHER tab", () => {
      store.dispatch(setDeploymentInfo(disableCodFor("takeaway")));
      mount();

      expect(screen.getByTestId("payment-counter")).toBeInTheDocument();
    });

    it("hides the tile and dead-ends politely when COD is off for THIS tab", () => {
      store.dispatch(setDeploymentInfo(disableCodFor("table")));
      mount();

      expect(screen.getByTestId("payment-unavailable")).toBeInTheDocument();
      expect(screen.queryByTestId("payment-screen")).not.toBeInTheDocument();
      expect(screen.queryByTestId("payment-counter")).not.toBeInTheDocument();
      // Rule 1: a dead end still has a way back.
      expect(screen.getByTestId("payment-back")).toBeInTheDocument();
    });

    it("matches the tab case-insensitively (SDK lowercases both sides)", () => {
      store.dispatch(setDeploymentInfo(disableCodFor("TABLE")));
      mount();

      expect(screen.getByTestId("payment-unavailable")).toBeInTheDocument();
    });

    it("keeps COD available when the deployment blob has not landed yet", () => {
      // DELIBERATE DIVERGENCE (Rule 2): the SDK check returns false for a
      // missing blob, which would hide the ONLY payment method on a slow
      // boot. "Not decidable" must fail OPEN, not into a dead end.
      store.dispatch(setDeploymentInfo([]));
      mount();

      expect(screen.getByTestId("payment-counter")).toBeInTheDocument();
    });

    it("keeps COD available when the tab type has not landed yet", () => {
      store.dispatch(setTabType(""));
      store.dispatch(setDeploymentInfo(disableCodFor("table")));
      mount();

      expect(screen.getByTestId("payment-counter")).toBeInTheDocument();
    });

    it("gives the unavailable screen a working Back", () => {
      store.dispatch(setDeploymentInfo(disableCodFor("table")));
      mount();
      tap("payment-back");

      expect(mockNavigate).toHaveBeenCalledWith("/customerName");
    });
  });

  describe("the PAY AT COUNTER label (label only — the type never changes)", () => {
    it('reads "pay at counter" for the pay_at_counter string enum', () => {
      store.dispatch(setKioskSettings({ pay_at_counter: "pay_at_counter" }));
      mount();

      expect(screen.getByTestId("payment-counter")).toHaveTextContent(
        i18n.t("payment.payAtCounter")
      );
    });

    it('reads "pay at counter" for the legacy boolean true', () => {
      store.dispatch(setKioskSettings({ pay_at_counter: true }));
      mount();

      expect(screen.getByTestId("payment-counter")).toHaveTextContent(
        i18n.t("payment.payAtCounter")
      );
    });

    it('falls back to "pay at restaurant" for the other enum member', () => {
      store.dispatch(setKioskSettings({ pay_at_counter: "pay_at_restaurant" }));
      mount();

      expect(screen.getByTestId("payment-counter")).toHaveTextContent(
        i18n.t("payment.payAtRestaurant")
      );
    });

    it('falls back to "pay at restaurant" when the setting is absent', () => {
      mount();

      expect(screen.getByTestId("payment-counter")).toHaveTextContent(
        i18n.t("payment.payAtRestaurant")
      );
    });

    it("dispatches PAY_AT_RESTAURANT whichever label was shown", () => {
      store.dispatch(setKioskSettings({ pay_at_counter: "pay_at_counter" }));
      mount();
      tap("payment-counter");

      expect(state().payment.paymentType).toBe("PAY_AT_RESTAURANT");
    });
  });

  describe("the card tile is inert — ⛔ no route to a gateway exists", () => {
    it("renders the card tile as an inert, non-interactive element", () => {
      mount();
      const card = screen.getByTestId("payment-card");

      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute("aria-disabled", "true");
      // Not a button and not a link: there is nothing for a tap to activate.
      expect(card.tagName).toBe("DIV");
      expect(card).toHaveTextContent(i18n.t("payment.comingSoon"));
    });

    it("does nothing at all when the card tile is tapped", () => {
      mount();
      tap("payment-card");
      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(buffer()).not.toBeInTheDocument();
      expect(state().payment.paymentType).toBe("");
      expect(mockPushOrder).not.toHaveBeenCalled();
    });
  });

  describe("the total bar", () => {
    it("shows the net amount the bag checked out with, plus the symbol", () => {
      store.dispatch(setAmount(9));
      mount();

      expect(screen.getByTestId("payment-total")).toHaveTextContent("£9.00");
      expect(screen.getByTestId("payment-total")).toHaveTextContent(
        i18n.t("payment.total")
      );
    });

    it("renders a bare amount when the currency blob is the legacy number 1", () => {
      store.dispatch(setCurrency(1));
      mount();

      expect(screen.getByTestId("payment-total")).toHaveTextContent("24.50");
    });
  });

  describe("the cancel buffer — nothing is pushed on this screen", () => {
    it("opens the buffer with a Cancel and pushes nothing", () => {
      mount();
      tap("payment-counter");

      expect(buffer()).toBeInTheDocument();
      expect(screen.getByTestId("payment-buffer-cancel")).toBeInTheDocument();
      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockGenerateQROrderId).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("hands over to the receipt step after the buffer elapses", () => {
      mount();
      tap("payment-counter");

      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(mockNavigate).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(mockNavigate).toHaveBeenCalledWith("/receipt");
      // Still nothing pushed — the push lives on /receipt.
      expect(mockPushOrder).not.toHaveBeenCalled();
    });

    it("Cancel closes the buffer and never navigates", () => {
      mount();
      tap("payment-counter");
      tap("payment-buffer-cancel");

      expect(buffer()).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockPushOrder).not.toHaveBeenCalled();
    });

    it("ignores a second tap while the buffer is already open", () => {
      mount();
      tap("payment-counter");
      tap("payment-counter");

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("does not navigate after the screen unmounts mid-buffer", () => {
      const view = mount();
      tap("payment-counter");
      view.unmount();

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe("back and mount guards", () => {
    it("goes back to the identity step when CRM is not skipped", () => {
      mount();
      tap("payment-back");

      expect(mockNavigate).toHaveBeenCalledWith("/customerName");
    });

    it("goes back to the bag when CRM is skipped", () => {
      store.dispatch(setKioskSettings({ skip_crm_page: true }));
      mount();
      tap("payment-back");

      expect(mockNavigate).toHaveBeenCalledWith("/cart");
    });

    it("bounces to the menu when there is nothing to pay for", () => {
      store.dispatch(setCartItems([]));
      mount();

      expect(mockNavigate).toHaveBeenCalledWith("/menu", { replace: true });
    });
  });
});
