import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setPaymentSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import {
  getDetailedPaymentType,
  getPaymentType,
} from "@cx-sdk/ordering/order/orderBuilder";
import { store } from "../../../redux/app/store";
import ReceiptPreferenceScreen from "../index";
import i18n from "../../../i18n";

/*
  P8b — /receipt's Paytm branch at the SCREEN: the real usePaytmCheckout and
  usePayAtCounter, real PleaseWait / ErrorModal / i18n. Mocked edges: the two
  initiate triggers, the id generator, useOrderHook (getPushOrderData for
  Paytm, pushOrder for COD), navigate, analytics and the lazy /paymentPolling
  screen loader (arrived, unless a case says not). The money rules live in
  usePaytmCheckout.test; this suite pins what the customer sees and can tap.
*/

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  capture: vi.fn(),
  dqr: vi.fn(),
  edc: vi.fn(),
  pushOrder: vi.fn(),
  ids: vi.fn(),
  loadScreen: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => m.navigate,
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => m.capture(...args),
}));
vi.mock("../../../hooks/menuHooks/useOrderHook", () => ({
  default: () => ({
    pushOrder: (...args: unknown[]) => m.pushOrder(...args),
    generateQROrderId: () => Promise.resolve("TB-ORDER-ABCDE12345"),
    getPushOrderData: () => {
      const type = (store.getState() as { payment: { paymentType: string } }).payment.paymentType;
      return Promise.resolve({
        toPush: {
          payments: { type: getPaymentType(type) },
          originalPayments: { cards: [{ detail: [{ otherName: getDetailedPaymentType(type) }] }] },
        },
      });
    },
  }),
}));
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

const option = (label: string, fields: Record<string, string>) => ({
  _id: `pay_${label}`,
  tenant_id: "tenant1",
  deployment_id: "dep1",
  setting_label: label,
  value: [{ id: "activate", value: true }, ...Object.entries(fields).map(([id, value]) => ({ id, value }))],
});
const EDC = option("PaytmEdc", { paytm_device_id: "EDC-DEVICE-1" });
const DQR = option("PaytmDynamicQr", { paytm_dqr_merchant_guid: "MID-1", paytm_dqr_secret_key: "KEY-1" });
const BUSY = { error: { status: 400, data: { msg: "Multiple payment request not allowed" } } };

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
/** One macrotask: the COD push's 0 ms buffer hop. */
const macrotask = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/receipt"]}>
        <ReceiptPreferenceScreen />
      </MemoryRouter>
    </Provider>,
  );
const tap = async (testId: string) => {
  fireEvent.click(screen.getByTestId(testId));
  await flush();
};
const modal = () => screen.getByTestId("paytm-initiate-failed");
const posBillNo = (trigger: typeof m.edc, call: number) =>
  (trigger.mock.calls[call]?.[0] as { posBillNo?: string }).posBillNo;
const receiptEvents = () =>
  m.capture.mock.calls.filter(([, props]) => (props as { screen?: string })?.screen === "receipt");

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  let n = 0;
  m.loadScreen.mockResolvedValue(() => null);
  m.ids.mockImplementation(() => {
    n += 1;
    return Promise.resolve({ posBillNo: `1700000000000${n}`, posBillTime: 1_700_000_000_000 + n });
  });
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCartItems([{ id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 9 }]));
  store.dispatch(setAmount(9));
  store.dispatch(setPaymentSettings([EDC, DQR]));
});

describe("/receipt — the Paytm branch (P8b)", () => {
  it("a receipt tap starts the Paytm initiate under PleaseWait; tiles and BACK are inert while it runs", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    const answer = deferred<unknown>();
    m.edc.mockReturnValue(answer.promise);
    mount();
    expect(screen.queryByTestId("paytm-preparing")).not.toBeInTheDocument();

    await tap("receipt-print");

    const wait = screen.getByTestId("paytm-preparing");
    expect(wait).toHaveAttribute("role", "status");
    expect(wait).toHaveTextContent(i18n.t("paytm.wait.title"));
    expect(wait).toHaveTextContent(i18n.t("paytm.wait.preparing"));
    await tap("receipt-none");
    await tap("receipt-print");
    await tap("receipt-back");
    expect(m.edc).toHaveBeenCalledTimes(1);
    expect(m.navigate).not.toHaveBeenCalled();
    expect(m.pushOrder).not.toHaveBeenCalled();
    expect(receiptEvents()).toEqual([["other", { screen: "receipt", receipt_preference: "print" }]]);

    await act(async () => answer.resolve({ data: { success: true } }));
    await flush();
    expect(m.navigate).toHaveBeenCalledTimes(1);
    expect(m.navigate).toHaveBeenCalledWith("/paymentPolling", { state: { receipt: "print" } });
  });

  it("busy: the busy copy, TRY AGAIN re-initiates with NEW ids, and no PAY ANOTHER WAY", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    m.edc.mockResolvedValueOnce(BUSY).mockResolvedValueOnce({ data: { success: true } });
    mount();
    await tap("receipt-none");

    expect(screen.queryByTestId("paytm-preparing")).not.toBeInTheDocument();
    expect(modal()).toHaveTextContent(i18n.t("paytm.failed.title"));
    expect(modal()).toHaveTextContent(i18n.t("paytm.failed.busy"));
    expect(screen.getByTestId("paytm-initiate-retry")).toHaveTextContent(i18n.t("paytm.failed.tryAgain"));
    expect(screen.queryByTestId("paytm-initiate-other")).not.toBeInTheDocument();

    // The tiles stay inert under the modal.
    await tap("receipt-print");
    expect(m.edc).toHaveBeenCalledTimes(1);

    await tap("paytm-initiate-retry");
    expect(m.edc).toHaveBeenCalledTimes(2);
    expect(posBillNo(m.edc, 1)).not.toBe(posBillNo(m.edc, 0));
    expect(m.navigate).toHaveBeenCalledWith("/paymentPolling", { state: { receipt: "none" } });
  });

  it("a retryable failure: BACK TO BAG closes the modal and leaves for /cart", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmDynamicQr" }));
    m.dqr.mockResolvedValue({ error: { status: 500, data: {} } });
    mount();
    await tap("receipt-print");

    expect(modal()).toHaveTextContent(i18n.t("paytm.failed.start"));
    expect(screen.getByTestId("paytm-initiate-bag")).toHaveTextContent(i18n.t("orderError.backToBag"));
    await tap("paytm-initiate-bag");

    expect(m.navigate).toHaveBeenCalledWith("/cart");
    expect(screen.queryByTestId("paytm-initiate-failed")).not.toBeInTheDocument();
    expect(m.dqr).toHaveBeenCalledTimes(1);
  });

  it("a local refusal: PAY ANOTHER WAY → /payment (no TRY AGAIN), nothing sent", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    store.dispatch(setPaymentSettings([DQR])); // no usable EDC option
    mount();
    await tap("receipt-none");

    expect(modal()).toHaveTextContent(i18n.t("paytm.failed.start"));
    expect(screen.queryByTestId("paytm-initiate-retry")).not.toBeInTheDocument();
    expect(screen.getByTestId("paytm-initiate-other")).toHaveTextContent(i18n.t("paytm.failed.payAnotherWay"));
    await tap("paytm-initiate-other");

    expect(m.navigate).toHaveBeenCalledTimes(1);
    expect(m.navigate).toHaveBeenCalledWith("/payment");
    expect(screen.queryByTestId("paytm-initiate-failed")).not.toBeInTheDocument();
    expect(m.edc).not.toHaveBeenCalled();
    expect(m.dqr).not.toHaveBeenCalled();
  });

  it("the /paymentPolling screen chunk did not arrive: the same refusal — PAY ANOTHER WAY (no TRY AGAIN), nothing sent, no ids", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    m.loadScreen.mockResolvedValue(null);
    mount();
    await tap("receipt-none");

    expect(modal()).toHaveTextContent(i18n.t("paytm.failed.start"));
    expect(screen.queryByTestId("paytm-initiate-retry")).not.toBeInTheDocument();
    await tap("paytm-initiate-other");
    expect(m.navigate).toHaveBeenCalledTimes(1);
    expect(m.navigate).toHaveBeenCalledWith("/payment");
    expect(m.ids).not.toHaveBeenCalled();
    expect(m.edc).not.toHaveBeenCalled();
    expect(m.dqr).not.toHaveBeenCalled();
  });

  it("COD is untouched: PAY_AT_RESTAURANT pushes through usePayAtCounter, no Paytm initiate, no PleaseWait", async () => {
    store.dispatch(setKioskPaymentType({ type: "PAY_AT_RESTAURANT" }));
    m.pushOrder.mockResolvedValue({});
    mount();
    await tap("receipt-print");
    await macrotask();
    await flush();

    expect(m.pushOrder).toHaveBeenCalledTimes(1);
    expect(m.pushOrder).toHaveBeenCalledWith("TB-ORDER-ABCDE12345", true, 9);
    expect(m.navigate).toHaveBeenCalledWith("/orderSuccess", { state: { receipt: "print" } });
    expect(m.edc).not.toHaveBeenCalled();
    expect(m.dqr).not.toHaveBeenCalled();
    expect(m.ids).not.toHaveBeenCalled();
    expect(screen.queryByTestId("paytm-preparing")).not.toBeInTheDocument();
    expect(receiptEvents()).toEqual([["other", { screen: "receipt", receipt_preference: "print" }]]);
  });
});
