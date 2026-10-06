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
  setPaymentSettings,
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

  ⛔ SAFETY (P8b): a Paytm tile only ARMS `payment.paymentType`. The initiate
  runs on /receipt, so the Paytm block below asserts that a tap here pushes
  and initiates NOTHING, and that only a usable configured option gets a tile.
*/

const mockNavigate = vi.fn();
const mockPushOrder = vi.fn();
const mockGenerateQROrderId = vi.fn();
const mockCapture = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
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
    mockCapture.mockReset();

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

  describe("the Paytm tiles (P8b) — a tap arms, nothing is sent from this screen", () => {
    /** The getKisokDeviceData entity the boot stores (contract §1, Cockpit fields). */
    const paytmOption = (settingLabel: string, fields: Record<string, string>) => ({
      _id: `pay_${settingLabel}`,
      tenant_id: "tenant1",
      deployment_id: "dep1",
      channel: "Kiosk",
      group: "payment",
      setting_label: settingLabel,
      setting_id: settingLabel,
      value: [
        { label: `Activate ${settingLabel}`, id: "activate", value: true, fieldType: "checkbox" },
        ...Object.entries(fields).map(([id, value]) => ({ label: id, id, value, fieldType: "text" })),
      ],
    });
    const PAYTM_EDC = paytmOption("PaytmEdc", { paytm_device_id: "EDC-1" });
    const PAYTM_DQR = paytmOption("PaytmDynamicQr", {
      paytm_dqr_merchant_guid: "MID-1",
      paytm_dqr_secret_key: "secret-1",
    });

    it("offers no card or QR tile when no Paytm gateway is configured", () => {
      mount();

      expect(screen.queryByTestId("payment-card")).not.toBeInTheDocument();
      expect(screen.queryByTestId("payment-qr")).not.toBeInTheDocument();
      expect(screen.getByTestId("payment-counter")).toBeInTheDocument();
    });

    it("an EDC tap arms PaytmEdc and hands over to /receipt after 3 s, pushing nothing", () => {
      store.dispatch(setPaymentSettings([PAYTM_EDC]));
      mount();
      tap("payment-card");

      expect(state().payment.paymentType).toBe("PaytmEdc");
      expect(buffer()).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(mockNavigate).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(mockNavigate).toHaveBeenCalledWith("/receipt");
      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockGenerateQROrderId).not.toHaveBeenCalled();
    });

    it("offers no card tile for an EDC option with a blank paytm_device_id", () => {
      store.dispatch(setPaymentSettings([paytmOption("PaytmEdc", { paytm_device_id: "" })]));
      mount();

      expect(screen.queryByTestId("payment-card")).not.toBeInTheDocument();
    });

    it("is unavailable only when there are no tiles AND no COD", () => {
      store.dispatch(setDeploymentInfo(disableCodFor("table")));
      store.dispatch(setPaymentSettings([PAYTM_EDC]));
      const view = mount();

      expect(screen.getByTestId("payment-card")).toBeInTheDocument();
      expect(screen.queryByTestId("payment-counter")).not.toBeInTheDocument();
      expect(screen.queryByTestId("payment-unavailable")).not.toBeInTheDocument();
      view.unmount();

      store.dispatch(setPaymentSettings([]));
      mount();
      expect(screen.getByTestId("payment-unavailable")).toBeInTheDocument();
    });

    it("the DQR tile is live: a tap arms PaytmDynamicQr, and Cancel disarms it", () => {
      store.dispatch(setPaymentSettings([PAYTM_DQR]));
      mount();
      tap("payment-qr");

      expect(state().payment.paymentType).toBe("PaytmDynamicQr");
      tap("payment-buffer-cancel");
      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(state().payment.paymentType).toBe("");
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockPushOrder).not.toHaveBeenCalled();
    });
  });

  describe("the Paytm tiles (P8b) — matrix, geometry, arming, cancel", () => {
    const paytmOption = (settingLabel: string, fields: Record<string, string>) => ({
      _id: `pay_${settingLabel}`,
      tenant_id: "tenant1",
      deployment_id: "dep1",
      setting_label: settingLabel,
      value: [
        { id: "activate", value: true },
        ...Object.entries(fields).map(([id, value]) => ({ id, value })),
      ],
    });
    const EDC = paytmOption("PaytmEdc", { paytm_device_id: "EDC-1" });
    const DQR = paytmOption("PaytmDynamicQr", {
      paytm_dqr_merchant_guid: "MID-1",
      paytm_dqr_secret_key: "secret-1",
    });
    const TILE_IDS = ["payment-card", "payment-qr", "payment-counter"];
    const tiles = () =>
      screen
        .queryAllByRole("button")
        .filter((button) => TILE_IDS.includes(button.dataset.testid ?? ""));
    const tileIds = () => tiles().map((tile) => tile.dataset.testid);
    const events = (name: string) =>
      mockCapture.mock.calls.filter(([event]) => event === name).map(([, props]) => props);
    const codOff = () => store.dispatch(setDeploymentInfo(disableCodFor("table")));
    const fetchSpy = vi.fn();

    beforeEach(() => {
      fetchSpy.mockReset();
      vi.stubGlobal("fetch", fetchSpy);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it.each([
      ["none", [], true, ["payment-counter"]],
      ["none", [], false, null],
      ["EDC", ["EDC"], true, ["payment-card", "payment-counter"]],
      ["EDC", ["EDC"], false, ["payment-card"]],
      ["DQR", ["DQR"], true, ["payment-qr", "payment-counter"]],
      ["DQR", ["DQR"], false, ["payment-qr"]],
      ["both", ["DQR", "EDC"], true, ["payment-card", "payment-qr", "payment-counter"]],
      ["both", ["EDC", "DQR"], false, ["payment-card", "payment-qr"]],
    ] as const)("Paytm %s, COD on=%s → %j (null = unavailable)", (_label, configured, cod, expected) => {
      store.dispatch(setPaymentSettings(configured.map((kind) => (kind === "EDC" ? EDC : DQR))));
      if (!cod) codOff();
      mount();

      if (expected === null) {
        expect(screen.getByTestId("payment-unavailable")).toBeInTheDocument();
        expect(tiles()).toHaveLength(0);
      } else {
        expect(screen.queryByTestId("payment-unavailable")).not.toBeInTheDocument();
        expect(tileIds()).toEqual(expected);
      }
      const gateways = configured.length;
      expect(events("payment_viewed")).toEqual([
        { method_count: gateways, cod_available: cod, net_amount: 24.5 },
      ]);
    });

    it.each([
      ["one tile: the Figma 412", [], [412], "text-[36px]", "px-[32px]"],
      ["two tiles: 2 × 412", ["EDC"], [412, 412], "text-[36px]", "px-[32px]"],
      ["three tiles: 3 × 266.67, the narrow label", ["EDC", "DQR"], [266.67, 266.67, 266.67], "text-[24px]", "px-[16px]"],
    ] as const)("%s", (_label, configured, widths, labelSize, padding) => {
      store.dispatch(setPaymentSettings(configured.map((kind) => (kind === "EDC" ? EDC : DQR))));
      mount();

      expect(tiles().map((tile) => Number.parseFloat(tile.style.width))).toEqual(
        widths.map((width) => expect.closeTo(width, 2)),
      );
      for (const tile of tiles()) {
        expect(tile).toHaveClass(padding);
        expect(tile.querySelector("span")).toHaveClass(labelSize);
      }
    });

    it.each([
      ["payment-card", "PaytmEdc", "paytm.redirecting"],
      ["payment-qr", "PaytmDynamicQr", "paytm.redirecting"],
      ["payment-counter", "PAY_AT_RESTAURANT", "payment.placingOrder"],
    ])("%s arms %s (and only arms it): buffer, then /receipt — nothing pushed or sent", (testId, type, titleKey) => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      mount();
      tap(testId);

      expect(state().payment.paymentType).toBe(type);
      expect(buffer()).toHaveTextContent(i18n.t(titleKey));
      expect(events("payment_method_selected")).toEqual([{ payment_type: type, net_amount: 24.5 }]);
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(mockNavigate).toHaveBeenCalledWith("/receipt");
      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockGenerateQROrderId).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      // Credentials never leave appSettings (D11).
      expect(JSON.stringify(state().payment)).not.toContain("secret-1");
    });

    it("a second tile tapped inside the window is ignored: ONE armed type, ONE navigation", () => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      mount();
      tap("payment-card");
      tap("payment-qr");
      tap("payment-counter");

      expect(state().payment.paymentType).toBe("PaytmEdc");
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["payment-card", "PaytmEdc"],
      ["payment-qr", "PaytmDynamicQr"],
    ])("Cancel on a %s buffer disarms to '' and reports payment_type %s — once", (testId, type) => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      mount();
      tap(testId);
      tap("payment-buffer-cancel");

      expect(state().payment.paymentType).toBe("");
      expect(events("payment_initiation_cancelled")).toEqual([{ payment_type: type, net_amount: 24.5 }]);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(buffer()).not.toBeInTheDocument();
    });

    it("Cancel on the COD buffer reports PAY_AT_RESTAURANT (the type stays pinned — fork parity)", () => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      mount();
      tap("payment-counter");
      tap("payment-buffer-cancel");

      const cancelled = events("payment_initiation_cancelled");
      expect(cancelled.length).toBeGreaterThan(0);
      for (const props of cancelled) expect(props).toMatchObject({ payment_type: "PAY_AT_RESTAURANT" });
      expect(state().payment.paymentType).toBe("PAY_AT_RESTAURANT");
    });

    it("nothing to charge hides the gateway tiles — COD still offered, or unavailable without it", () => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      store.dispatch(setAmount(0));
      const view = mount();
      expect(tileIds()).toEqual(["payment-counter"]);
      expect(events("payment_viewed")).toEqual([{ method_count: 0, cod_available: true, net_amount: 0 }]);
      view.unmount();

      codOff();
      mount();
      expect(screen.getByTestId("payment-unavailable")).toBeInTheDocument();
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
