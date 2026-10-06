import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setBillPaymentInfo,
  setKioskPaymentType,
  setPaytmQrCode,
} from "@cx-sdk/payments/state/payment.slice";
import {
  setCurrency,
  setEnableAccessibilityMode,
  setPaymentSettings,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
import PaytmPayment from "../index";
import i18n, { isolate } from "../../../i18n";
import bellPurple from "../../../assets/brand/tb-bell-purple.svg";
import creditCard from "../../../assets/payment/credit-card.svg";

/*
  /paymentPolling as the customer sees it (P8b-06/07/08). The settlement
  rules are usePaytmSettlement.test; here: the testids, copy, countdown, the
  overlays per phase and the ADA layout, with the REAL hook, PleaseWait,
  PaytmQr (react-qr-code) and ErrorModal. Mocked edges: the three Paytm
  triggers, useOrderHook, navigate, analytics.
*/

type Envelope = { data?: unknown; error?: unknown };
const m = vi.hoisted(() => ({ navigate: vi.fn() }));
let statusImpl: () => Promise<Envelope>;
let voidImpl: () => Promise<Envelope>;

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => m.navigate,
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: () => undefined,
}));
vi.mock("../../../hooks/menuHooks/useOrderHook", () => ({
  default: () => ({ recordOrderLocally: () => Promise.resolve() }),
}));
vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", () => ({
  useCheckPaytmDqrKioskStatusMutation: () => [() => statusImpl()],
  useCheckPaytmEdcKioskStatusMutation: () => [() => statusImpl()],
  useCancelPaytmEdcKioskMutation: () => [() => voidImpl()],
}));

const SETTINGS = [
  { setting_label: "PaytmEdc", tenant_id: "t", deployment_id: "d", value: [{ id: "paytm_device_id", value: "EDC-1" }] },
  {
    setting_label: "PaytmDynamicQr",
    tenant_id: "t",
    deployment_id: "d",
    value: [
      { id: "paytm_dqr_merchant_guid", value: "MID" },
      { id: "paytm_dqr_secret_key", value: "S" },
    ],
  },
];
const BILL = "17280000000054321";
const seed = (kind: "edc" | "dqr") => {
  store.dispatch(setCartItems([{ id: "cw", itemId: "cw-1", name: "CW", quantity: 1, type: "ITEM", total_price: 9 }]));
  store.dispatch(setAmount(9));
  store.dispatch(setCurrency({ symbol: "₹" }));
  store.dispatch(setAutenticationDetails({ deploymentDetails: { _id: "d" }, licenseDetails: {} }));
  store.dispatch(setPaymentSettings(SETTINGS));
  store.dispatch(setKioskPaymentType({ type: kind === "edc" ? "PaytmEdc" : "PaytmDynamicQr" }));
  store.dispatch(setBillPaymentInfo({ posBillNo: BILL, posBillTime: Date.now() }));
  if (kind === "dqr") store.dispatch(setPaytmQrCode("upi://pay?pa=tb@paytm&am=9.00"));
};
const ada = () => {
  store.dispatch(setEnableAccessibilityMode(true));
  store.dispatch(toggleAccessibilityMode());
};
const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/paymentPolling", state: { receipt: "none" } }]}>
        <PaytmPayment />
      </MemoryRouter>
    </Provider>,
  );
const tap = (testId: string) =>
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const step = async (ms: number) => {
  for (let left = ms; left > 0; left -= 1000) await advance(Math.min(1000, left));
};
const timeLeft = (time: string) => i18n.t("paytm.timeLeft", { time });
/** Small SVGs are inlined as data URIs, so an <img> is found by its exact src. */
const img = (container: HTMLElement, src: string) =>
  Array.from(container.querySelectorAll("img")).find((node) => node.getAttribute("src") === src) ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  store.dispatch({ type: "RESET_STATE" });
  m.navigate.mockReset();
  statusImpl = () => Promise.resolve({ data: { status: "pending" } });
  voidImpl = () => Promise.resolve({ data: { success: true } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PaytmPayment — /paymentPolling", () => {
  it("renders nothing without an open session (the hook redirects)", () => {
    const { container } = mount();
    expect(container.innerHTML).toBe("");
    expect(m.navigate).toHaveBeenCalledWith("/menu", { replace: true });
  });

  it("EDC (Figma 1:3404): title, card, TOTAL with the settings currency, DOWN HERE, countdown, CANCEL", async () => {
    seed("edc");
    const { container } = mount();

    expect(screen.getByTestId("paytm-screen")).toHaveTextContent(i18n.t("paytm.instructions.title"));
    expect(screen.getByText(i18n.t("paytm.instructions.downHere"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("paytm.edc.hint"))).toBeInTheDocument();
    expect(screen.getByTestId("paytm-total")).toHaveTextContent(`${i18n.t("payment.total")}₹9.00`);
    expect(screen.getByTestId("paytm-cancel")).toHaveTextContent(i18n.t("paytm.cancel"));
    expect(screen.queryByTestId("paytm-qr")).not.toBeInTheDocument();
    expect(img(container, bellPurple)).not.toBeNull();
    expect(img(container, creditCard)).toHaveClass("h-[277.2px]", "w-[431.2px]");

    expect(screen.getByTestId("paytm-countdown")).toHaveTextContent(timeLeft("3:00"));
    await step(2000);
    expect(screen.getByTestId("paytm-countdown")).toHaveTextContent(timeLeft("2:58"));
    await step(169_000);
    expect(screen.getByTestId("paytm-countdown")).toHaveTextContent(timeLeft("0:09"));
  });

  it("DQR: the QR in the 616 slot while awaiting, the 2:15 window, no DOWN HERE", () => {
    seed("dqr");
    mount();

    const qr = screen.getByTestId("paytm-qr");
    expect(qr).toHaveAttribute("role", "img");
    expect(qr).toHaveAccessibleName(i18n.t("paytm.qr.title"));
    expect(qr.style.width).toBe("616px");
    expect(qr.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(i18n.t("paytm.qr.hint"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("paytm.instructions.downHere"))).not.toBeInTheDocument();
    expect(screen.getByTestId("paytm-countdown")).toHaveTextContent(timeLeft("2:15"));
  });

  it("CANCEL asks first: KEEP PAYING closes the confirm; YES cancels under PleaseWait, then the terminal prompt", async () => {
    seed("edc");
    mount();
    tap("paytm-cancel");
    const confirm = screen.getByTestId("paytm-cancel-confirm");
    expect(confirm).toHaveTextContent(i18n.t("paytm.cancelConfirm.title"));
    expect(confirm).toHaveTextContent(i18n.t("paytm.cancelConfirm.message"));
    expect(screen.getByTestId("paytm-cancel-keep")).toHaveTextContent(i18n.t("paytm.cancelConfirm.keep"));
    tap("paytm-cancel-keep");
    expect(screen.queryByTestId("paytm-cancel-confirm")).not.toBeInTheDocument();

    tap("paytm-cancel");
    tap("paytm-cancel-yes");
    expect(screen.getByTestId("paytm-confirming")).toHaveTextContent(i18n.t("paytm.wait.cancelling"));
    expect(screen.queryByTestId("paytm-cancel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("paytm-countdown")).not.toBeInTheDocument();

    await advance(0); // the fresh read is pending → the void reaches the terminal
    expect(screen.queryByTestId("paytm-confirming")).not.toBeInTheDocument();
    // YES-only (UI-F3): polling ends 30 s after the void, so NO is never offered.
    expect(screen.getByTestId("paytm-terminal-prompt")).toHaveTextContent(i18n.t("paytm.edc.pressYesToCancel"));
    expect(screen.getByTestId("paytm-terminal-prompt")).not.toHaveTextContent(i18n.t("paytm.edc.pressYes"));
    expect(screen.queryByText(i18n.t("paytm.edc.hint"))).not.toBeInTheDocument();
  });

  // UI-F3 / F2 (flagged for client sign-off; the AR draft for native review).
  // Copy is read through i18n.t in the language under test — never a literal.
  it.each(["en", "ar"])("YES-only terminal prompt in %s: exactly paytm.edc.pressYesToCancel — offers YES, never NO, never the old YES/NO line", async (lng) => {
    await act(async () => {
      await i18n.changeLanguage(lng);
    });
    try {
      seed("edc");
      mount();
      tap("paytm-cancel");
      tap("paytm-cancel-yes");
      await advance(0); // the fresh read is pending → the void reaches the terminal

      const prompt = screen.getByTestId("paytm-terminal-prompt");
      // Explicit lng: an EN render in the AR run fails here.
      expect(prompt.textContent).toBe(i18n.t("paytm.edc.pressYesToCancel", { lng }));
      expect(prompt.textContent).not.toBe(i18n.t("paytm.edc.pressYes", { lng }));
      expect(prompt.textContent).not.toMatch(/paytm\./);
      // YES-only by meaning, whatever the wording: YES is offered, NO never
      // is (EN "NO", AR "لا") — a reworded YES/NO line under the new key fails.
      // The FSI/PDI isolates (P9f) split too: AR text is wrapped in them, and
      // an edge word glued to one ("لا" + PDI) would slip past not.toContain.
      const words = (prompt.textContent ?? "").toUpperCase().split(/[\s,.،!?؟⁨⁩]+/u);
      if (lng === "ar") expect(prompt.textContent).toMatch(/^⁨[^⁨⁩]+⁩$/u);
      expect(words).toContain(lng === "en" ? "YES" : "نعم");
      expect(words).not.toContain(lng === "en" ? "NO" : "لا");
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("the YES-only key is add-only and translated: both locales keep the old YES/NO key, and AR is not the EN fallback", () => {
    const key = "paytm.edc.pressYesToCancel";
    for (const lng of ["en", "ar"]) {
      // getResource never falls back to EN, unlike t/exists.
      expect(i18n.getResource(lng, "translation", key), `${lng} ${key}`).toEqual(expect.any(String));
      expect(i18n.getResource(lng, "translation", "paytm.edc.pressYes"), `${lng} pressYes`).toEqual(expect.any(String));
    }
    expect(i18n.t(key, { lng: "ar" })).not.toBe(i18n.t(key, { lng: "en" }));
  });

  it("a void_in_progress answer asks the guest to approve on the machine", async () => {
    seed("edc");
    voidImpl = () => Promise.resolve({ data: { status: "void_in_progress" } });
    mount();
    tap("paytm-cancel");
    tap("paytm-cancel-yes");
    await advance(0);
    expect(screen.getByTestId("paytm-terminal-prompt")).toHaveTextContent(i18n.t("paytm.edc.approveOnMachine"));
  });

  it("DQR: the QR copy on the confirm; at expiry PleaseWait hides the QR, then the expired panel → BACK TO BAG", async () => {
    seed("dqr");
    mount();
    tap("paytm-cancel");
    expect(screen.getByTestId("paytm-cancel-confirm")).toHaveTextContent(i18n.t("paytm.cancelConfirm.messageQr"));
    tap("paytm-cancel-keep");

    await step(135_000);
    expect(screen.getByTestId("paytm-confirming")).toHaveTextContent(i18n.t("paytm.wait.confirming"));
    expect(screen.queryByTestId("paytm-qr")).not.toBeInTheDocument();
    await step(30_000);

    const failed = screen.getByTestId("paytm-failed");
    expect(failed).toHaveTextContent(i18n.t("paytm.failed.title"));
    expect(failed).toHaveTextContent(i18n.t("paytm.failed.expired"));
    expect(screen.getByTestId("paytm-failed-retry")).toHaveTextContent(i18n.t("paytm.failed.tryAgain"));
    tap("paytm-failed-bag");
    expect(m.navigate).toHaveBeenCalledWith("/cart");
  });

  it("a cancelled read shows the cancelled copy; TRY AGAIN → /payment", async () => {
    seed("edc");
    statusImpl = () => Promise.resolve({ data: { status: "cancelled" } });
    mount();
    await advance(3000);
    expect(screen.getByTestId("paytm-failed")).toHaveTextContent(i18n.t("paytm.failed.cancelled"));
    tap("paytm-failed-retry");
    expect(m.navigate).toHaveBeenCalledWith("/payment");
  });

  it("paid: PleaseWait while Order Complete is reached", async () => {
    seed("edc");
    statusImpl = () => Promise.resolve({ data: { status: "paid" } });
    mount();
    await advance(3000);
    expect(screen.getByTestId("paytm-confirming")).toHaveTextContent(i18n.t("paytm.wait.confirming"));
    expect(m.navigate).toHaveBeenCalledWith("/orderSuccess", { state: { receipt: "none" } });
  });

  it("the unknown panel: the order's last 5, the checking note, CHECK AGAIN / FINISH", async () => {
    seed("edc");
    statusImpl = () => Promise.resolve({ error: { status: "FETCH_ERROR" } });
    mount();
    await step(180_000 + 30_000);

    const panel = screen.getByTestId("paytm-unknown");
    expect(panel).toHaveTextContent(i18n.t("paytm.unknown.title"));
    expect(panel).toHaveTextContent(i18n.t("paytm.unknown.message", { order: "54321" }));
    expect(screen.queryByTestId("paytm-terminal-prompt")).not.toBeInTheDocument();
    let release: ((envelope: Envelope) => void) | undefined;
    statusImpl = () =>
      new Promise<Envelope>((resolve) => {
        release = resolve;
      });
    tap("paytm-unknown-check");
    expect(screen.getByTestId("paytm-unknown-note")).toHaveTextContent(i18n.t("paytm.unknown.checking"));
    await act(async () => release?.({ data: { status: "pending" } }));
    expect(screen.queryByTestId("paytm-unknown-note")).not.toBeInTheDocument();

    tap("paytm-unknown-finish");
    expect(m.navigate).toHaveBeenCalledWith("/start");
  });

  // P9f: Arabic is RTL text in the LTR layout — the countdown time and the
  // order number are i18n VALUES, so each is its own FSI…PDI isolate (no
  // strong character inside → LTR digits) within the isolated Arabic copy.
  it("Arabic: the countdown time and the staff panel's order number stay LTR isolates; the TOTAL digits stay plain", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    try {
      const template = (key: string) => String(i18n.getResource("ar", "translation", key));
      seed("edc");
      statusImpl = () => Promise.resolve({ error: { status: "FETCH_ERROR" } });
      mount();

      expect(screen.getByTestId("paytm-countdown").textContent).toBe(
        isolate(template("paytm.timeLeft").replace("{{time}}", isolate("3:00"))),
      );
      expect(screen.getByTestId("paytm-total").textContent).toBe(`${isolate(template("payment.total"))}₹9.00`);

      await step(180_000 + 30_000);
      expect(document.getElementById("paytm-unknown-message")?.textContent).toBe(
        isolate(template("paytm.unknown.message").replace("{{order}}", isolate("54321"))),
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("ADA: bell dropped, the column at 40, a 360 slot (QR and card)", () => {
    seed("dqr");
    ada();
    const dqr = mount();
    expect(screen.getByTestId("paytm-qr").style.width).toBe("360px");
    expect(img(dqr.container, bellPurple)).toBeNull();
    expect(dqr.container.querySelector(".top-\\[40px\\]")).not.toBeNull();
    expect(dqr.container.querySelector(".top-\\[435px\\]")).toBeNull();
    dqr.unmount();

    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    const edc = mount();
    expect(img(edc.container, creditCard)).toHaveClass("h-[162px]", "w-[252px]");
    expect(img(edc.container, bellPurple)).toBeNull();
    expect(screen.getByTestId("paytm-cancel")).toBeInTheDocument();
  });

  it("no timer outlives the screen", async () => {
    seed("edc");
    const view = mount();
    await advance(3000);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
