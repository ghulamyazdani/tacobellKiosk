/* eslint-disable @typescript-eslint/no-explicit-any --
 * Deployment-settings and cart fixtures mirror the untyped SDK slices; typed
 * with those slices, not here. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  setCurrency,
  setDeploymentInfo,
  setKioskSettings,
  setPaymentSettings,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { getDetailedPaymentType } from "@cx-sdk/ordering/order/orderBuilder";
import { readOpenPaytmSession } from "@cx-sdk/payments/gateways/paytmKiosk";
import { store } from "../../../redux/app/store";
import { notePath } from "../../../hooks/utils/usePageEnter";
import PaymentSelection from "../index";
import i18n from "../../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n.

  Mocked, and only these:
  - useNavigate — the COD window ends in a navigation to /receipt, a Paytm
    initiate in one to /paymentPolling, and Back has a two-way fan-out; all
    have to be assertable.
  - useOrderHook — usePayAtCounter (imported by this screen for beginCheckout /
    cancelCheckout) pulls the real order hook, which drags in RTK Query
    mutations, IndexedDB and a whole converted menu. The push itself has its
    own suite; here the spies exist to prove this screen pushes NOTHING. Its
    getPushOrderData builds order_details from the payment type of the RENDER
    it was made in, exactly like the real hook (useOrderHook.ts:78,256).
  - the Paytm edges usePaytmCheckout reaches: the two initiate triggers, the
    id generator and the lazy /paymentPolling screen loader (arrived, unless
    a case says not). The money rules live in usePaytmCheckout.test.

  The COD gate, the label flip and the total all run through the REAL
  selectors and the REAL SDK `checkIfCODAvailable`, so a fixture written
  against the wrong key spelling fails instead of silently passing.

  ⛔ SAFETY (P8b; the receipt question follows the payment since 2026-10-13):
  a Paytm tile only ARMS `payment.paymentType` and opens the 3 s window —
  nothing is sent inside it. The window's END is the initiate (here, on
  /payment), so the Paytm blocks below assert nothing leaves before 3000 ms,
  exactly ONE initiate after it, and that only a usable configured option gets
  a tile.
*/

const mockNavigate = vi.fn();
const mockPushOrder = vi.fn();
const mockGenerateQROrderId = vi.fn();
const mockCapture = vi.fn();
const m = vi.hoisted(() => ({
  dqr: vi.fn(),
  edc: vi.fn(),
  ids: vi.fn(),
  loadScreen: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("../../../hooks/menuHooks/useOrderHook", async () => {
  const { useSelector } = await import("react-redux");
  const { selectKioskPaymentType } = await import("@cx-sdk/payments/state/payment.slice");
  const orderBuilder = await import("@cx-sdk/ordering/order/orderBuilder");
  return {
    default: function useOrderHookMock() {
      // RENDER-time, like the real hook: /payment's window timer runs the
      // tap's render, where this was still "".
      const type: unknown = useSelector(selectKioskPaymentType);
      return {
        pushOrder: (...args: unknown[]) => mockPushOrder(...args),
        generateQROrderId: (...args: unknown[]) => mockGenerateQROrderId(...args),
        getPushOrderData: () =>
          Promise.resolve({
            toPush: {
              payments: { type: orderBuilder.getPaymentType(type) },
              originalPayments: {
                cards: [{ detail: [{ otherName: orderBuilder.getDetailedPaymentType(type) }] }],
              },
            },
            pushOrderData: {},
          }),
      };
    },
  };
});
vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useInitiatePaytmDqrKioskMutation: () => [(body: unknown) => m.dqr(body)],
  useInitiatePaytmEdcKioskMutation: () => [(body: unknown) => m.edc(body)],
}));
vi.mock("@cx-sdk/payments/gateways/paymentSession", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generatePaymentIds: () => m.ids(),
}));
vi.mock("../../PaytmPayment/loadPaytmScreen", () => ({
  loadPaytmScreen: () => m.loadScreen(),
}));

const state = () => store.getState() as any;
const QR = "upi://pay?pa=tb@paytm&am=24.50";
const BUSY = { error: { status: 400, data: { msg: "Multiple payment request not allowed" } } };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
/** Let the initiate's promise chain (chunk → ids → flush → order_details → trigger) run. */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
/** The body the n-th call of a trigger carried. */
const sent = (trigger: typeof m.edc, call = 0) => trigger.mock.calls[call]?.[0] as any;

/**
 * A "Disable COD for Kiosk" row with ONE ticked tab. Since audit-fixes A2 the
 * SDK's `checkIfCODAvailable` is the fork's live rule: the row by `name` or
 * `label`, the tab by `tabs[].tabType` (take-out spellings as one family),
 * and only `selected: true` disables COD — `tabLabel` is no longer read
 * (the full rule table: src/__tests__/codAvailability.test.ts).
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
    Object.values(m).forEach((fn) => fn.mockReset());
    let n = 0;
    m.ids.mockImplementation(() => {
      n += 1;
      return Promise.resolve({ posBillNo: `1700000000000${n}`, posBillTime: 1_700_000_000_000 + n });
    });
    m.loadScreen.mockResolvedValue(() => null);
    m.edc.mockResolvedValue({ data: { success: true } });
    m.dqr.mockResolvedValue({ data: { qrCode: QR } });

    store.dispatch({ type: "RESET_STATE" });
    seedCart();
    store.dispatch(setTabType("table"));
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
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

    /*
      audit-fixes A2 at the screen: Cockpit's DEFAULT row lists every tab
      unticked. The old SDK rule matched tabLabel and ignored `selected`, so a
      table session lost its only tender under it.
    */
    it("A2: Cockpit's default row (every tab unticked) keeps PAY AT COUNTER for a table session", () => {
      store.dispatch(
        setDeploymentInfo([
          { name: "disable_roundoff", label: "Disable Round Off", selected: false },
          {
            name: "disable_cod_kiosk",
            label: "Disable COD for Kiosk",
            selected: false,
            tabs: [
              { tabLabel: "Table", tabType: "table", selected: false },
              { tabLabel: "Take Out", tabType: "takeout", selected: false },
              { tabLabel: "Delivery", tabType: "delivery", selected: false },
            ],
          },
        ])
      );
      mount();

      expect(screen.getByTestId("payment-counter")).toBeInTheDocument();
      expect(screen.queryByTestId("payment-unavailable")).not.toBeInTheDocument();
    });

    it("A2: a take_out session under a ticked 'takeaway' tab has no COD (the take-out spellings are one tab)", () => {
      store.dispatch(setTabType("take_out"));
      store.dispatch(setDeploymentInfo(disableCodFor("takeaway")));
      mount();

      expect(screen.getByTestId("payment-unavailable")).toBeInTheDocument();
      expect(screen.queryByTestId("payment-counter")).not.toBeInTheDocument();
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

    it("gives the unavailable screen a working BACK — to the step before /payment, never the menu", () => {
      store.dispatch(setDeploymentInfo(disableCodFor("table")));
      mount();
      expect(screen.getByTestId("payment-back")).toHaveTextContent(i18n.t("payment.back"));
      tap("payment-back");

      // CRM shown (the suite's default): the name step.
      expect(mockNavigate.mock.calls).toEqual([["/customerName"]]);
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

    // U1 (2026-10-13): the receipt question follows the payment, so the
    // window's end IS the initiate — here, never a hop to /receipt.
    it.each([
      ["payment-card", "PaytmEdc", m.edc],
      ["payment-qr", "PaytmDynamicQr", m.dqr],
    ] as const)("a %s window ends in ONE initiate HERE: nothing at 2999 ms; at 3000 PleaseWait replaces the window at once; → /paymentPolling", async (testId, type, trigger) => {
      store.dispatch(setPaymentSettings([PAYTM_EDC, PAYTM_DQR]));
      const answer = deferred<unknown>();
      trigger.mockReturnValue(answer.promise);
      mount();
      tap(testId);

      expect(state().payment.paymentType).toBe(type);
      expect(buffer()).toBeInTheDocument();
      advance(2999);
      await flush();
      expect(trigger).not.toHaveBeenCalled();
      expect(m.ids).not.toHaveBeenCalled();
      expect(screen.queryByTestId("paytm-preparing")).not.toBeInTheDocument();

      advance(1);
      // ONE commit drops the window and mounts PleaseWait, so it shows at
      // once — it replaces a dialog (PleaseWait.tsx; motion-v2 review F1).
      expect(buffer()).not.toBeInTheDocument();
      const wait = screen.getByTestId("paytm-preparing");
      expect(wait).not.toHaveClass("tb-reveal-late");
      expect(wait).toHaveTextContent(i18n.t("paytm.wait.preparing"));
      await flush();
      expect(m.edc.mock.calls.length + m.dqr.mock.calls.length).toBe(1);
      expect(trigger).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();

      await act(async () =>
        answer.resolve(type === "PaytmEdc" ? { data: { success: true } } : { data: { qrCode: QR } })
      );
      await flush();
      expect(mockNavigate.mock.calls).toEqual([["/paymentPolling"]]);
      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockGenerateQROrderId).not.toHaveBeenCalled();
    });

    // U2: the timer runs the TAP's render, whose order hook still saw type
    // "" — without the latest-ref the H-c guard would refuse every first
    // initiate as order_details_mismatch.
    it("the window-fired initiate parks the ARMED type (order_details built for PaytmEdc), no refusal", async () => {
      store.dispatch(setPaymentSettings([PAYTM_EDC]));
      mount();
      tap("payment-card");
      advance(3000);
      await flush();

      expect(m.edc).toHaveBeenCalledTimes(1);
      expect(sent(m.edc).order_details.payments.type).toBe("ONLINE");
      expect(sent(m.edc).order_details.originalPayments.cards[0].detail[0].otherName).toBe(
        getDetailedPaymentType("PaytmEdc")
      );
      expect(screen.queryByTestId("paytm-initiate-failed")).not.toBeInTheDocument();
      expect(mockCapture.mock.calls.filter(([name]) => name === "payment_initiated")).toHaveLength(1);
      expect(mockNavigate.mock.calls).toEqual([["/paymentPolling"]]);
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
      ["one tile: the Figma 416", [], [416], "px-[32px]"],
      ["two tiles: 2 × 416", ["EDC"], [416, 416], "px-[32px]"],
      ["three tiles: 3 × 269.33, the narrow padding", ["EDC", "DQR"], [269.33, 269.33, 269.33], "px-[16px]"],
    ] as const)("%s, labels in the frame's Cm Bd 48/44 — an Arabic label leads 64 (its wrapped lines touched at 44)", (_label, configured, widths, padding) => {
      store.dispatch(setPaymentSettings(configured.map((kind) => (kind === "EDC" ? EDC : DQR))));
      mount();

      expect(tiles().map((tile) => Number.parseFloat(tile.style.width))).toEqual(
        widths.map((width) => expect.closeTo(width, 2)),
      );
      for (const tile of tiles()) {
        expect(tile).toHaveClass(padding, "h-[416px]");
        expect(tile.querySelector("span")).toHaveClass(
          "tb-compressed",
          "text-[48px]",
          "leading-[44px]",
          "[&:lang(ar)]:leading-[64px]",
        );
      }
    });

    it.each([
      ["payment-card", "PaytmEdc", "paytm.redirecting"],
      ["payment-qr", "PaytmDynamicQr", "paytm.redirecting"],
      // The default kiosk settings label the COD tile PAY AT RESTAURANT.
      ["payment-counter", "PAY_AT_RESTAURANT", "payment.payAtRestaurantChosen"],
    ])("%s arms %s: the window sends nothing; its end is /receipt for COD (nothing pushed) and ONE initiate for Paytm", async (testId, type, titleKey) => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      mount();
      tap(testId);

      expect(state().payment.paymentType).toBe(type);
      expect(buffer()).toHaveTextContent(i18n.t(titleKey));
      expect(events("payment_method_selected")).toEqual([{ payment_type: type, net_amount: 24.5 }]);
      advance(2999);
      await flush();
      expect(m.edc).not.toHaveBeenCalled();
      expect(m.dqr).not.toHaveBeenCalled();
      advance(1);
      await flush();
      if (type === "PAY_AT_RESTAURANT") {
        expect(mockNavigate.mock.calls).toEqual([["/receipt"]]);
        expect(m.edc).not.toHaveBeenCalled();
        expect(m.dqr).not.toHaveBeenCalled();
      } else {
        expect(m.edc.mock.calls.length + m.dqr.mock.calls.length).toBe(1);
        expect((type === "PaytmEdc" ? m.edc : m.dqr).mock.calls).toHaveLength(1);
        expect(mockNavigate.mock.calls).toEqual([["/paymentPolling"]]);
      }
      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockGenerateQROrderId).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      // Credentials never leave appSettings (D11).
      expect(JSON.stringify(state().payment)).not.toContain("secret-1");
    });

    it("a second tile tapped inside the window is ignored: ONE armed type, ONE initiate", async () => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      mount();
      tap("payment-card");
      tap("payment-qr");
      tap("payment-counter");

      expect(state().payment.paymentType).toBe("PaytmEdc");
      advance(3000);
      await flush();
      expect(m.edc).toHaveBeenCalledTimes(1);
      expect(m.dqr).not.toHaveBeenCalled();
      expect(mockNavigate.mock.calls).toEqual([["/paymentPolling"]]);
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

    /*
      The Paytm initiate on /payment (2026-10-13; moved off /receipt): its wait
      (PleaseWait 1:4456) and its failure modal (1:6288 layout) sit over the
      tiles. While either is up nothing under them may start a second window
      or leave the screen.
    */
    const modal = () => screen.getByTestId("paytm-initiate-failed");
    /** The modal's CTAs in DOM order (ErrorModal renders the secondary first). */
    const ctaIds = () =>
      within(modal())
        .getAllByRole("button")
        .map((cta) => cta.dataset.testid);
    const preparing = () => screen.queryByTestId("paytm-preparing");

    // U3
    it("busy: PleaseWait while initiating (a covered tile and BACK do nothing), then the busy modal — CLOSE · TRY AGAIN, focus on CLOSE; TRY AGAIN → a second initiate with NEW ids; CLOSE → the tiles, in place", async () => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      m.edc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      mount();
      tap("payment-card");
      advance(3000);
      await flush();

      expect(preparing()).toHaveTextContent(i18n.t("paytm.wait.title"));
      tap("payment-qr");
      tap("payment-card");
      tap("payment-back");
      await flush();
      expect(buffer()).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(m.edc).toHaveBeenCalledTimes(1);
      expect(m.dqr).not.toHaveBeenCalled();

      await act(async () => first.resolve(BUSY));
      await flush();
      expect(preparing()).not.toBeInTheDocument();
      expect(modal()).toHaveTextContent(i18n.t("paytm.failed.title"));
      expect(modal()).toHaveTextContent(i18n.t("paytm.failed.busy"));
      expect(ctaIds()).toEqual(["paytm-initiate-close", "paytm-initiate-retry"]);
      expect(screen.getByTestId("paytm-initiate-retry")).toHaveTextContent(i18n.t("paytm.failed.tryAgain"));
      expect(screen.getByTestId("paytm-initiate-close")).toHaveTextContent(i18n.t("language.close"));
      // The safe choice: TRY AGAIN mints new ids and may arm the terminal.
      expect(screen.getByTestId("paytm-initiate-close")).toHaveFocus();
      // Under the modal a covered tile stays inert too (nothing is in flight
      // there, so BACK keeps its way out — the unavailable branch needs it).
      tap("payment-qr");
      expect(buffer()).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();

      tap("paytm-initiate-retry");
      await flush();
      expect(m.edc).toHaveBeenCalledTimes(2);
      expect(sent(m.edc, 1).posBillNo).not.toBe(sent(m.edc, 0).posBillNo);
      // TRY AGAIN replaces the dialog: PleaseWait at once (F1).
      expect(preparing()).not.toHaveClass("tb-reveal-late");

      await act(async () => second.resolve(BUSY));
      await flush();
      expect(screen.getByTestId("paytm-initiate-close")).toHaveFocus();
      tap("paytm-initiate-close");
      expect(screen.queryByTestId("paytm-initiate-failed")).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(tileIds()).toEqual(["payment-card", "payment-qr", "payment-counter"]);
      expect(m.edc).toHaveBeenCalledTimes(2);
      expect(events("payment_viewed")).toHaveLength(1);
    });

    // The live walk (2026-10-14): this modal offered only BACK TO MY BAG and
    // TRY AGAIN — no way to stay on /payment and pay another way.
    it("a retryable rejection (\"We couldn't start the payment\"): CLOSE · TRY AGAIN, focus on CLOSE; CLOSE closes it in place with the attempt cleared — no ids, no armed type, no open session — and PAY AT COUNTER runs its window to /receipt", async () => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      m.edc.mockResolvedValue({ error: { status: 400, data: { msg: "Invalid request" } } });
      mount();
      tap("payment-card");
      advance(3000);
      await flush();

      expect(modal()).toHaveTextContent(i18n.t("paytm.failed.start"));
      expect(ctaIds()).toEqual(["paytm-initiate-close", "paytm-initiate-retry"]);
      expect(screen.getByTestId("paytm-initiate-close")).toHaveFocus();
      // Under the modal the hook has cleared the ids; the type stays armed
      // for TRY AGAIN until the guest decides.
      expect(state().payment.posBillNo).toBe("");
      expect(state().payment.paymentType).toBe("PaytmEdc");

      tap("paytm-initiate-close");
      expect(screen.queryByTestId("paytm-initiate-failed")).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(tileIds()).toEqual(["payment-card", "payment-qr", "payment-counter"]);
      expect(state().payment.paymentType).toBe("");
      expect(state().payment.posBillNo).toBe("");
      expect(readOpenPaytmSession(state().payment)).toBeNull();

      advance(500); // CLOSE's tap guard
      tap("payment-counter");
      expect(state().payment.paymentType).toBe("PAY_AT_RESTAURANT");
      // walk-flow-ui (2026-10-14): the window confirms the choice, never "placing".
      expect(buffer()).toHaveTextContent(i18n.t("payment.payAtRestaurantChosen"));
      advance(3000);
      await flush();
      expect(mockNavigate.mock.calls).toEqual([["/receipt"]]);
      expect(m.edc).toHaveBeenCalledTimes(1);
      expect(m.dqr).not.toHaveBeenCalled();
    });

    // U4 (a)
    it("a local refusal (the Paytm rows gone during the window): the non-retryable modal at 3000 ms offers CLOSE alone, focused; it closes it in place, disarmed, nothing minted or sent; PAY AT COUNTER is live", async () => {
      store.dispatch(setPaymentSettings([EDC]));
      mount();
      tap("payment-card");
      act(() => {
        store.dispatch(setPaymentSettings([]));
      });
      advance(3000);
      await flush();

      // A retry would only be refused again; CLOSE is the one way on, and the
      // copy no longer asks for a retry it cannot offer.
      expect(modal()).toHaveTextContent(i18n.t("paytm.failed.startNoRetry"));
      expect(ctaIds()).toEqual(["paytm-initiate-close"]);
      expect(screen.getByTestId("paytm-initiate-close")).toHaveTextContent(i18n.t("language.close"));
      expect(screen.getByTestId("paytm-initiate-close")).toHaveFocus();
      tap("paytm-initiate-close");

      expect(screen.queryByTestId("paytm-initiate-failed")).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(state().payment.paymentType).toBe("");
      expect(m.ids).not.toHaveBeenCalled();
      expect(m.edc).not.toHaveBeenCalled();
      expect(m.dqr).not.toHaveBeenCalled();
      tap("payment-counter");
      expect(buffer()).toHaveTextContent(i18n.t("payment.payAtRestaurantChosen"));
    });

    // U4 (b)
    it("the /paymentPolling chunk did not arrive: the same refusal; CLOSE → a fresh tap on the SAME tile opens the window again and refuses again — nothing minted or sent", async () => {
      store.dispatch(setPaymentSettings([EDC]));
      m.loadScreen.mockResolvedValue(null);
      mount();
      tap("payment-card");
      advance(3000);
      await flush();
      expect(modal()).toHaveTextContent(i18n.t("paytm.failed.startNoRetry"));
      tap("paytm-initiate-close");
      expect(screen.queryByTestId("paytm-initiate-failed")).not.toBeInTheDocument();

      tap("payment-card");
      expect(buffer()).toHaveTextContent(i18n.t("paytm.redirecting"));
      advance(3000);
      await flush();
      expect(modal()).toHaveTextContent(i18n.t("paytm.failed.startNoRetry"));
      expect(m.loadScreen).toHaveBeenCalledTimes(2);
      expect(m.ids).not.toHaveBeenCalled();
      expect(m.edc).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    /*
      U11 (contract review R1): the window's controls outlive its timer by one
      commit. Until the timer's batch renders, CANCEL and BACK are still
      painted and still run the WINDOW render's handlers — and with a warm chunk
      the initiate has already left. One act = that frame: the timer fires and
      the captured control is clicked before anything commits.
    */
    it("a CANCEL from the timer's frame changes nothing: the type stays armed, no cancel event, ONE initiate → /paymentPolling", async () => {
      store.dispatch(setPaymentSettings([EDC]));
      mount();
      tap("payment-card");
      const cancel = screen.getByTestId("payment-buffer-cancel");
      act(() => {
        vi.advanceTimersByTime(3000);
        fireEvent.click(cancel);
      });
      await flush();

      expect(state().payment.paymentType).toBe("PaytmEdc");
      expect(events("payment_initiation_cancelled")).toEqual([]);
      expect(m.edc).toHaveBeenCalledTimes(1);
      expect(mockNavigate.mock.calls).toEqual([["/paymentPolling"]]);
    });

    it("a BACK from the timer's frame (keyboard / AT — the window covers it for a finger) never leaves under the initiate", async () => {
      store.dispatch(setPaymentSettings([EDC]));
      mount();
      tap("payment-card");
      const back = screen.getByTestId("payment-back");
      act(() => {
        vi.advanceTimersByTime(3000);
        fireEvent.click(back);
      });
      await flush();

      expect(mockNavigate.mock.calls).toEqual([["/paymentPolling"]]);
      expect(events("payment_dismissed")).toEqual([]);
      expect(m.edc).toHaveBeenCalledTimes(1);
    });

    it("pin: a CANCEL inside the window still disarms and sends nothing", async () => {
      store.dispatch(setPaymentSettings([EDC]));
      mount();
      tap("payment-card");
      advance(2999);
      tap("payment-buffer-cancel");
      advance(10_000);
      await flush();

      expect(state().payment.paymentType).toBe("");
      expect(events("payment_initiation_cancelled")).toHaveLength(1);
      expect(m.edc).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    /*
      Review 2 F1: a window's end is an initiate now, so a tile armed by the
      second tap of a double tap moves money 3 s later. That tap lands on
      whatever this screen paints under the finger: a tile under the window's
      CANCEL or the modal's CLOSE (both close at once), and on
      arrival a tile under /paymentPolling's TRY AGAIN. jsdom does not
      hit-test, so these pin the guard's life; paytm.spec R7 / R8 drive the
      real double taps.
    */
    const tapGuard = () => screen.queryByTestId("payment-tap-guard");

    it("the tap guard covers the screen for its first 500 ms (the second tap of the screen before)", () => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      mount();

      expect(tapGuard()).toHaveAttribute("aria-hidden", "true");
      advance(499);
      expect(tapGuard()).toBeInTheDocument();
      advance(1);
      expect(tapGuard()).not.toBeInTheDocument();
    });

    it.each(["payment-card", "payment-counter"])("CANCEL on a %s window re-arms the tap guard for 500 ms", (testId) => {
      store.dispatch(setPaymentSettings([EDC, DQR]));
      mount();
      advance(500);
      tap(testId);
      expect(tapGuard()).not.toBeInTheDocument();

      tap("payment-buffer-cancel");
      expect(buffer()).not.toBeInTheDocument();
      expect(tapGuard()).toBeInTheDocument();
      advance(499);
      expect(tapGuard()).toBeInTheDocument();
      advance(1);
      expect(tapGuard()).not.toBeInTheDocument();
    });

    it.each([
      ["a local refusal's CLOSE (alone)", false],
      ["a retryable rejection's CLOSE (beside TRY AGAIN)", true],
    ])("%s re-arms the tap guard for 500 ms; the window's own end does not", async (_label, retryable) => {
      store.dispatch(setPaymentSettings([EDC]));
      if (retryable) m.edc.mockResolvedValue({ error: { status: 400, data: {} } });
      else m.loadScreen.mockResolvedValue(null);
      mount();
      advance(500);
      tap("payment-card");
      advance(3000);
      await flush();
      expect(modal()).toHaveTextContent(
        i18n.t(retryable ? "paytm.failed.start" : "paytm.failed.startNoRetry")
      );
      expect(screen.queryByTestId("paytm-initiate-retry") !== null).toBe(retryable);
      expect(tapGuard()).not.toBeInTheDocument();

      tap("paytm-initiate-close");
      expect(tapGuard()).toBeInTheDocument();
      advance(500);
      expect(tapGuard()).not.toBeInTheDocument();
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

    it("falls back to ₹ when the currency blob is the legacy number 1 (UB1: never a bare amount)", () => {
      store.dispatch(setCurrency(1));
      mount();

      expect(screen.getByTestId("payment-total")).toHaveTextContent("₹24.50");
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

    // motion-v2 MV3: the 3 s window was a still card; it shows the house sweep,
    // a sibling of CANCEL (never in or around the button).
    it("the window shows the house indeterminate sweep between the title and CANCEL", () => {
      mount();
      tap("payment-counter");

      const sweep = buffer()?.querySelectorAll(".tb-indeterminate") ?? [];
      expect(sweep).toHaveLength(1);
      const track = sweep[0].parentElement as HTMLElement;
      expect(track).toHaveClass("overflow-hidden", "bg-tb-lilac", "mb-[40px]");
      expect(track).toHaveAttribute("aria-hidden");
      expect(track.previousElementSibling).toHaveAttribute("id", "payment-buffer-title");
      expect(track.previousElementSibling).toHaveClass("mb-[32px]");
      expect(track.nextElementSibling).toBe(screen.getByTestId("payment-buffer-cancel"));
      expect(sweep[0].closest("button")).toBeNull();
      // CANCEL shows at once: the window never reveals late (motion-v2 MV4 "NOT on").
      expect(screen.getByTestId("payment-buffer-cancel").closest(".tb-reveal-late")).toBeNull();
    });

    // Walk 2026-10-14: the window said PLACING YOUR ORDER… while nothing is
    // placed until /receipt's answer (2026-10-13). It confirms the tile the
    // guest tapped, in its words; PLACING stays /receipt's push.
    it.each([
      ["PAY AT COUNTER", { pay_at_counter: "pay_at_counter" }, "payment.payAtCounterChosen"],
      ["PAY AT RESTAURANT", {}, "payment.payAtRestaurantChosen"],
    ])("%s: the window confirms that choice, with CANCEL — never 'placing' (EN, AR)", async (_tile, settings, key) => {
      store.dispatch(setKioskSettings({ skip_crm_page: false, ...settings }));
      mount();
      tap("payment-counter");

      const title = () => document.getElementById("payment-buffer-title");
      expect(buffer()).toHaveAttribute("aria-labelledby", "payment-buffer-title");
      expect(title()).toHaveTextContent(i18n.t(key));
      expect(buffer()).not.toHaveTextContent(i18n.t("payment.placingOrder"));
      expect(screen.getByTestId("payment-buffer-cancel")).toHaveTextContent(i18n.t("payment.cancel"));

      await act(async () => {
        await i18n.changeLanguage("ar");
      });
      try {
        expect(title()).toHaveTextContent(i18n.t(key));
        expect(buffer()).not.toHaveTextContent(i18n.t("payment.placingOrder"));
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
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
    // User 2026-10-14: BACK returns to the screen the guest came from — the
    // name step, or with CRM hidden "the previous level". It read BACK TO MENU
    // and went to the menu (walk-flow-ui), which this supersedes.
    it("reads BACK (EN and AR), never BACK TO MENU", async () => {
      mount();
      const back = screen.getByTestId("payment-back");
      expect(back).toHaveTextContent(i18n.t("payment.back"));
      expect(back.textContent).not.toMatch(/menu/i);

      await act(async () => {
        await i18n.changeLanguage("ar");
      });
      expect(back).toHaveTextContent(i18n.t("payment.back"));
      expect(back.textContent).not.toContain(i18n.t("cancelOrder.cancel"));
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    });

    it("CRM shown: BACK returns to the name step — never the menu", () => {
      mount();
      tap("payment-back");

      expect(mockNavigate.mock.calls).toEqual([["/customerName"]]);
      expect(mockCapture.mock.calls.filter(([event]) => event === "payment_dismissed")).toHaveLength(1);
    });

    it("CRM hidden, a table order: BACK skips the name step to the table number", () => {
      store.dispatch(setKioskSettings({ skip_crm_page: true }));
      mount();
      tap("payment-back");

      expect(mockNavigate.mock.calls).toEqual([["/tent"]]);
    });

    it("CRM hidden, no table step: BACK returns to the bag", () => {
      store.dispatch(setKioskSettings({ skip_crm_page: true }));
      store.dispatch(setTabType("dine_in"));
      mount();
      tap("payment-back");

      expect(mockNavigate.mock.calls).toEqual([["/cart"]]);
    });

    it("bounces to the menu when there is nothing to pay for", () => {
      store.dispatch(setCartItems([]));
      mount();

      expect(mockNavigate).toHaveBeenCalledWith("/menu", { replace: true });
    });
  });

  /*
    Lane figma-polish S4 #1/#2/#4 (1:3364 / 1:3375 / 1:3376): the headline is
    Title/H2 (Exp Bl 64/54.4, −3) in the frame's 856 px block at 572, the TOTAL
    bar 856 wide at 744, the CTA Cards 416 × 416 in the 856 row at 932, the
    bell at 128. ADA keeps its P9c tops (title 120 · total 302 · tiles 482).
  */
  describe("the Figma geometry (S4)", () => {
    const headline = () => screen.getByRole("heading", { level: 1 });
    const tileRow = () => screen.getByTestId("payment-counter").parentElement as HTMLElement;
    const H2 = ["text-[64px]", "leading-[54.4px]", "tracking-[-3px]", "w-[856px]"];

    it("the headline is Title/H2 in the 856 px block at top 572; the bell sits at 128", () => {
      mount();

      expect(headline()).toHaveTextContent(i18n.t("payment.title"));
      expect(headline()).toHaveClass(...H2, "top-[572px]");
      expect(headline().className).not.toMatch(/text-\[58px\]|w-\[880px\]|top-\[566px\]/);
      expect(screen.getByAltText("Taco Bell")).toHaveClass("top-[128px]");
    });

    it("the TOTAL bar is 856 wide at 744; the tile row sits at 932 and every tile is 416 tall", () => {
      store.dispatch(setPaymentSettings([]));
      mount();

      expect(screen.getByTestId("payment-total")).toHaveClass("w-[856px]", "top-[744px]");
      expect(tileRow()).toHaveClass("top-[932px]", "gap-[24px]");
      expect(screen.getByTestId("payment-counter")).toHaveClass("h-[416px]");
      expect(screen.getByTestId("payment-counter").style.width).toBe("416px");
    });

    it("the unavailable headline is the same Title/H2 at 572", () => {
      store.dispatch(setDeploymentInfo(disableCodFor("table")));
      mount();

      expect(screen.getByTestId("payment-unavailable")).toBeInTheDocument();
      expect(headline()).toHaveTextContent(i18n.t("payment.unavailable"));
      expect(headline()).toHaveClass(...H2, "top-[572px]");
    });

    it("ADA keeps its tops: title 120, TOTAL 302, tiles 482 — no bell", () => {
      store.dispatch(toggleAccessibilityMode());
      mount();

      expect(headline()).toHaveClass(...H2, "top-[120px]");
      expect(screen.getByTestId("payment-total")).toHaveClass("w-[856px]", "top-[302px]");
      expect(tileRow()).toHaveClass("top-[482px]");
      expect(screen.getByTestId("payment-counter")).toHaveClass("h-[416px]");
      expect(screen.queryByAltText("Taco Bell")).not.toBeInTheDocument();
    });

    it("ADA unavailable: the title stays at 120", () => {
      store.dispatch(toggleAccessibilityMode());
      store.dispatch(setDeploymentInfo(disableCodFor("table")));
      mount();

      expect(headline()).toHaveClass(...H2, "top-[120px]");
    });
  });

  /*
    Lane motion (§2.3 / §2.7). The root's data-enter is latched at mount: none
    on a page load (POP), fwd on a PUSH, back on a PUSH to a screen already on
    the session trail (AppRoutes' notePath; seeded here). Only the content
    blocks carry tb-enter [--i]; the chrome, BACK and the buffer never move.
  */
  describe("motion", () => {
    /** A PUSH from another route: <Navigate> fires after the first commit. */
    const mountPushed = () =>
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={["/from"]}>
            <Routes>
              <Route path="/from" element={<Navigate to="/payment" />} />
              <Route path="/payment" element={<PaymentSelection />} />
            </Routes>
          </MemoryRouter>
        </Provider>
      );
    const root = () => screen.getByTestId("payment-screen");

    beforeEach(() => {
      notePath("/start");
    });

    it("a page load (POP) mounts still; a PUSH arrives fwd; a PUSH back to a visited /payment arrives back", () => {
      const pop = mount();
      expect(root()).not.toHaveAttribute("data-enter");
      pop.unmount();

      const pushed = mountPushed();
      expect(root()).toHaveAttribute("data-enter", "fwd");
      pushed.unmount();

      notePath("/payment");
      notePath("/receipt");
      mountPushed();
      expect(root()).toHaveAttribute("data-enter", "back");
    });

    it("tb-enter [--i] on the title, TOTAL and the tile row (0–2) — never the bell, BACK or the buffer", () => {
      mountPushed();
      const blocks = [...root().querySelectorAll(".tb-enter")];
      expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1", "2"]);
      expect(blocks[1]).toBe(screen.getByTestId("payment-total"));
      expect(blocks[2]).toContainElement(screen.getByTestId("payment-counter"));

      tap("payment-counter"); // the cancel buffer opens
      for (const element of [screen.getByAltText("Taco Bell"), screen.getByTestId("payment-back"), buffer() as HTMLElement]) {
        expect(element.closest(".tb-enter")).toBeNull();
      }
    });

    it("the unavailable dead end never animates, even on a PUSH", () => {
      store.dispatch(setDeploymentInfo(disableCodFor("table")));
      mountPushed();

      expect(screen.getByTestId("payment-unavailable")).not.toHaveAttribute("data-enter");
      expect(screen.getByTestId("payment-unavailable").querySelector("[data-enter], .tb-enter")).toBeNull();
    });
  });
});
