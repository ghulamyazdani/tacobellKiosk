import { describe, expect, it } from "vitest";
import {
  PAYTM_PAYMENT_TYPES,
  buildPaytmEdcVoidBody,
  buildPaytmKioskStatusBody,
  classifyPaytmEdcVoidResult,
  classifyPaytmKioskPoll,
  decidePaytmInitiate,
  isPaytmInitiateOutcomeUnknown,
  isPaytmOrderDetailsConsistent,
  paytmWindowMs,
  pickPaytmSelections,
  readOpenPaytmSession,
  toPaytmKind,
  type OpenPaytmSession,
  type PaytmInitiateDecision,
  type PaytmKind,
} from "@cx-sdk/payments/gateways/paytmKiosk";
import {
  PAYTM_DQR_STOP_TIMER_SECONDS,
  PAYTM_EDC_STOP_TIMER_SECONDS,
  buildPaytmDqrKioskStatusPayload,
  buildPaytmEdcKioskCancelPayload,
  buildPaytmEdcKioskStatusPayload,
} from "@cx-sdk/payments/gateways/paytm";
import paymentReducer, {
  emptyPayment,
  setBillPaymentInfo,
  setKioskPaymentType,
  setPaytmQrCode,
} from "@cx-sdk/payments/state/payment.slice";
import {
  getDetailedPaymentType,
  getPaymentType,
} from "@cx-sdk/ordering/order/orderBuilder";

/*
  P8b money logic, gateway half (@cx-sdk/payments/gateways/paytmKiosk): which
  Paytm tiles are offered, what an initiate result means (await vs fail —
  never a second EDC initiate on an unknown outcome), the H-c order_details
  guard, the one "open session" definition, and the status / void bodies.
  Fixtures are the real getKisokDeviceData entity shapes (contract §1).
*/

interface Setting {
  label: string;
  id: string;
  value: unknown;
  fieldType: string;
}
interface DeviceEntity {
  _id: string;
  tenant_id: string;
  deployment_id: string;
  license_key: string;
  channel: string;
  group: string;
  setting_label: string;
  setting_id: string;
  value: Setting[];
}

const entity = (label: string, settings: Setting[]): DeviceEntity => ({
  _id: `pay_${label}`,
  tenant_id: "tenant1",
  deployment_id: "dep1",
  license_key: "mock-device-token",
  channel: "Kiosk",
  group: "payment",
  setting_label: label,
  setting_id: label,
  value: [
    { label: `Activate ${label}`, id: "activate", value: true, fieldType: "checkbox" },
    ...settings,
  ],
});
const text = (id: string, value: unknown): Setting => ({
  label: id,
  id,
  value,
  fieldType: "text",
});

const DQR_ENTITY = entity("PaytmDynamicQr", [
  text("paytm_dqr_merchant_guid", "MID-E2E"),
  text("paytm_dqr_secret_key", "e2e-secret"),
]);
const EDC_ENTITY = entity("PaytmEdc", [text("paytm_device_id", "EDC-E2E-1")]);

/** Copy of `e` with setting `id` set to `value` (removed when undefined). */
const withSetting = (e: DeviceEntity, id: string, value: unknown): DeviceEntity => ({
  ...e,
  value: e.value
    .filter((s) => s.id !== id || value !== undefined)
    .map((s) => (s.id === id ? { ...s, value } : s)),
});

// RTK trigger results, as fetchBaseQuery 2.12 produces them.
const ok = (data: unknown) => ({ data });
const http = (status: number, data: unknown = {}) => ({ error: { status, data } });
const TIMEOUT = { error: { status: "TIMEOUT_ERROR", error: "AbortError: signal timed out" } };
const MID_BODY_TIMEOUT = {
  error: { status: "PARSING_ERROR", originalStatus: 200, data: "", error: "TimeoutError: signal timed out" },
};
const LOST_BODY = {
  error: { status: "PARSING_ERROR", originalStatus: 200, data: "not-json", error: "SyntaxError: Unexpected token" },
};
const PROXY_HTML_502 = {
  error: { status: "PARSING_ERROR", originalStatus: 502, data: "<html>", error: "SyntaxError: Unexpected token" },
};
const CLIENT_HTML_400 = {
  error: { status: "PARSING_ERROR", originalStatus: 400, data: "<html>", error: "SyntaxError: Unexpected token" },
};
const FETCH = { error: { status: "FETCH_ERROR", error: "TypeError: Failed to fetch" } };
const BUSY_MSG = "Multiple payment request not allowed";

describe("toPaytmKind / PAYTM_PAYMENT_TYPES", () => {
  it("maps the two wire strings, exact case only", () => {
    expect(toPaytmKind("PaytmDynamicQr")).toBe("paytmDqr");
    expect(toPaytmKind("PaytmEdc")).toBe("paytmEdc");
    for (const kind of ["paytmDqr", "paytmEdc"] as const) {
      expect(toPaytmKind(PAYTM_PAYMENT_TYPES[kind])).toBe(kind);
    }
    for (const junk of [
      "paytmdynamicqr", "PAYTMEDC", " PaytmEdc", "PaytmDynamicQR", "PaytmEDC",
      "Geidea", "PAY_AT_RESTAURANT", "", null, undefined, 42, {},
    ]) {
      expect(toPaytmKind(junk)).toBeNull();
    }
  });

  it("windows come from the verbatim fork constants (DQR 135 s, EDC 180 s)", () => {
    expect(paytmWindowMs("paytmDqr")).toBe(PAYTM_DQR_STOP_TIMER_SECONDS * 1000);
    expect(paytmWindowMs("paytmEdc")).toBe(PAYTM_EDC_STOP_TIMER_SECONDS * 1000);
    expect([paytmWindowMs("paytmDqr"), paytmWindowMs("paytmEdc")]).toEqual([135_000, 180_000]);
  });
});

describe("pickPaytmSelections", () => {
  it("flattens value[] id → value and builds the fork's paymentInfo", () => {
    expect(pickPaytmSelections([EDC_ENTITY, DQR_ENTITY])).toEqual([
      {
        kind: "paytmEdc",
        paymentType: "PaytmEdc",
        paymentInfo: { tenant_id: "tenant1", deployment_id: "dep1", paymentType: "PaytmEdc" },
        paymentSettings: { activate: true, paytm_device_id: "EDC-E2E-1" },
      },
      {
        kind: "paytmDqr",
        paymentType: "PaytmDynamicQr",
        paymentInfo: { tenant_id: "tenant1", deployment_id: "dep1", paymentType: "PaytmDynamicQr" },
        paymentSettings: {
          activate: true,
          paytm_dqr_merchant_guid: "MID-E2E",
          paytm_dqr_secret_key: "e2e-secret",
        },
      },
    ]);
  });

  it("keeps option order", () => {
    const kinds = (options: unknown) => pickPaytmSelections(options).map((s) => s.kind);
    expect(kinds([DQR_ENTITY, EDC_ENTITY])).toEqual(["paytmDqr", "paytmEdc"]);
    expect(kinds([EDC_ENTITY, DQR_ENTITY])).toEqual(["paytmEdc", "paytmDqr"]);
  });

  it("ignores every non-Paytm gateway and other casings, even with Paytm credentials", () => {
    const creds = [
      text("paytm_device_id", "D"),
      text("paytm_dqr_merchant_guid", "M"),
      text("paytm_dqr_secret_key", "S"),
    ];
    const others = [
      "Geidea", "NetworkInternational", "mashreq", "Mashreq", "MASHREQ", "PineLabs", "PineLabsPlutus", "PineLabsPlutusUPI",
      "RazorpayPaymentsLink", "NeoLeap", "Dojo", "PAY_AT_RESTAURANT", "paytmedc", "PAYTMDYNAMICQR",
    ].map((label) => entity(label, creds));
    expect(pickPaytmSelections(others)).toEqual([]);
  });

  it("drops an option whose credentials are missing, blank or not strings", () => {
    for (const bad of [undefined, "", "   ", 123, null, true]) {
      expect(pickPaytmSelections([withSetting(EDC_ENTITY, "paytm_device_id", bad)])).toEqual([]);
      expect(pickPaytmSelections([withSetting(DQR_ENTITY, "paytm_dqr_merchant_guid", bad)])).toEqual([]);
      expect(pickPaytmSelections([withSetting(DQR_ENTITY, "paytm_dqr_secret_key", bad)])).toEqual([]);
    }
  });

  it("takes the FIRST usable option per kind; an unusable one does not block a later one", () => {
    const blankEdc = withSetting(EDC_ENTITY, "paytm_device_id", "");
    const secondEdc = withSetting(EDC_ENTITY, "paytm_device_id", "EDC-2");
    const picked = pickPaytmSelections([blankEdc, EDC_ENTITY, secondEdc, DQR_ENTITY]);
    expect(picked.map((s) => [s.kind, s.paymentSettings.paytm_device_id])).toEqual([
      ["paytmEdc", "EDC-E2E-1"],
      ["paytmDqr", undefined],
    ]);
  });

  it("is total: junk input or junk options give [] instead of throwing", () => {
    for (const junk of [undefined, null, "PaytmEdc", 42, {}, { value: [] }]) {
      expect(pickPaytmSelections(junk)).toEqual([]);
    }
    expect(
      pickPaytmSelections([
        null,
        "PaytmEdc",
        42,
        [],
        { setting_label: "PaytmEdc" },
        { setting_label: "PaytmEdc", value: { id: "paytm_device_id", value: "D" } },
      ]),
    ).toEqual([]);
  });

  it("skips junk settings inside value[] and keeps the rest", () => {
    const messy = {
      ...EDC_ENTITY,
      value: [null, "x", { id: 5, value: "y" }, { id: "paytm_device_id", value: "D" }],
    };
    expect(pickPaytmSelections([messy])[0]?.paymentSettings).toEqual({ paytm_device_id: "D" });
  });

  it("a __proto__ setting id cannot inject credentials through the prototype", () => {
    const sneaky = {
      ...EDC_ENTITY,
      value: [{ id: "__proto__", value: { paytm_device_id: "INJECTED" } }],
    };
    expect(pickPaytmSelections([sneaky])).toEqual([]);
  });
});

describe("decidePaytmInitiate", () => {
  const FAIL_REJECTED: PaytmInitiateDecision = { action: "fail", reason: "rejected", retryable: true };
  const FAIL_UNKNOWN: PaytmInitiateDecision = { action: "fail", reason: "unknown", retryable: true };
  const FAIL_BUSY: PaytmInitiateDecision = { action: "fail", reason: "busy", retryable: true };
  const AWAIT_EDC: PaytmInitiateDecision = { action: "await", qrCode: null, outcomeUnknown: false };
  const AWAIT_EDC_UNKNOWN: PaytmInitiateDecision = { action: "await", qrCode: null, outcomeUnknown: true };

  it.each<[string, unknown, PaytmInitiateDecision]>([
    ["QR returned", ok({ qrCode: "upi://pay?pa=e2e@paytm&am=9.00" }),
      { action: "await", qrCode: "upi://pay?pa=e2e@paytm&am=9.00", outcomeUnknown: false }],
    ["200 without qrCode", ok({}), FAIL_REJECTED],
    ["empty qrCode", ok({ qrCode: "" }), FAIL_REJECTED],
    ["blank qrCode", ok({ qrCode: "   " }), FAIL_REJECTED],
    ["numeric qrCode", ok({ qrCode: 12345 }), FAIL_REJECTED],
    ["object qrCode", ok({ qrCode: { image: "x" } }), FAIL_REJECTED],
    ["400", http(400), FAIL_REJECTED],
    ["400 busy text (no busy concept for DQR)", http(400, { msg: BUSY_MSG }), FAIL_REJECTED],
    ["500", http(500), FAIL_UNKNOWN],
    ["504", http(504), FAIL_UNKNOWN],
    ["TIMEOUT_ERROR", TIMEOUT, FAIL_UNKNOWN],
    ["mid-body timeout", MID_BODY_TIMEOUT, FAIL_UNKNOWN],
    ["lost 2xx body", LOST_BODY, FAIL_UNKNOWN],
    ["5xx html body", PROXY_HTML_502, FAIL_UNKNOWN],
    ["FETCH_ERROR", FETCH, FAIL_UNKNOWN],
    ["no result", undefined, FAIL_REJECTED],
  ])("DQR · %s", (_name, response, expected) => {
    expect(decidePaytmInitiate("paytmDqr", response)).toEqual(expected);
  });

  it.each<[string, unknown, PaytmInitiateDecision]>([
    ["success:true", ok({ success: true, traceId: "t1", parkedOrder: {}, paytmResponse: {} }), AWAIT_EDC],
    ["success:\"true\" is not ok", ok({ success: "true" }), FAIL_REJECTED],
    ["200 success:false", ok({ success: false }), FAIL_REJECTED],
    ["400 busy", http(400, { msg: BUSY_MSG }), FAIL_BUSY],
    ["busy inside a longer msg", http(400, { msg: `Error: ${BUSY_MSG} for this device` }), FAIL_BUSY],
    ["busy on a 503 — busy is checked BEFORE unknown", http(503, { msg: BUSY_MSG }), FAIL_BUSY],
    ["400", http(400), FAIL_REJECTED],
    ["401", http(401), FAIL_REJECTED],
    ["404", http(404), FAIL_REJECTED],
    ["4xx html body", CLIENT_HTML_400, FAIL_REJECTED],
    ["500", http(500), AWAIT_EDC_UNKNOWN],
    ["502", http(502), AWAIT_EDC_UNKNOWN],
    ["504", http(504), AWAIT_EDC_UNKNOWN],
    ["TIMEOUT_ERROR", TIMEOUT, AWAIT_EDC_UNKNOWN],
    ["mid-body timeout", MID_BODY_TIMEOUT, AWAIT_EDC_UNKNOWN],
    ["lost 2xx body", LOST_BODY, AWAIT_EDC_UNKNOWN],
    ["5xx html body", PROXY_HTML_502, AWAIT_EDC_UNKNOWN],
    ["FETCH_ERROR", FETCH, AWAIT_EDC_UNKNOWN],
    ["error rethrown with a cause (TB shell style)",
      { error: new Error("initiate failed", { cause: { status: 504 } }) }, AWAIT_EDC_UNKNOWN],
    ["two-level cause chain to FETCH_ERROR",
      { error: new Error("outer", { cause: new Error("inner", { cause: FETCH.error }) }) }, AWAIT_EDC_UNKNOWN],
    ["no result", undefined, FAIL_REJECTED],
    ["non-envelope", "boom", FAIL_REJECTED],
  ])("EDC · %s", (_name, response, expected) => {
    expect(decidePaytmInitiate("paytmEdc", response)).toEqual(expected);
  });

  it("a DQR failure is always retryable and never 'await' (the QR was never shown)", () => {
    for (const response of [ok({}), http(400), http(500), TIMEOUT, LOST_BODY, FETCH, undefined]) {
      const decision = decidePaytmInitiate("paytmDqr", response);
      expect(decision).toMatchObject({ action: "fail", retryable: true });
    }
  });
});

describe("isPaytmInitiateOutcomeUnknown", () => {
  it("unknown: timeouts, lost bodies, transport drops and 5xx; known: 4xx, custom, junk", () => {
    for (const unknownError of [
      TIMEOUT.error, MID_BODY_TIMEOUT.error, LOST_BODY.error, PROXY_HTML_502.error, FETCH.error,
      { status: 500 }, { status: 503 }, { status: 504 }, { name: "TimeoutError" },
    ]) {
      expect(isPaytmInitiateOutcomeUnknown(unknownError)).toBe(true);
    }
    for (const knownError of [
      { status: 400 }, { status: 401 }, { status: 499 }, CLIENT_HTML_400.error,
      { status: "CUSTOM_ERROR", error: "x" }, null, undefined, "500", 504,
    ]) {
      expect(isPaytmInitiateOutcomeUnknown(knownError)).toBe(false);
    }
  });

  it("walks .cause at most 10 levels and survives a cycle", () => {
    const wrap = (inner: unknown, times: number): unknown => {
      let error = inner;
      for (let i = 0; i < times; i++) error = { cause: error };
      return error;
    };
    expect(isPaytmInitiateOutcomeUnknown(wrap({ status: 504 }, 9))).toBe(true);
    expect(isPaytmInitiateOutcomeUnknown(wrap({ status: 504 }, 10))).toBe(false);
    const cyclic: { status: number; cause?: unknown } = { status: 400 };
    cyclic.cause = cyclic;
    expect(isPaytmInitiateOutcomeUnknown(cyclic)).toBe(false);
  });
});

describe("isPaytmOrderDetailsConsistent (hazard H-c)", () => {
  /** The payments / originalPayments blocks orderBuilder builds for `paymentType`. */
  const orderDetails = (paymentType: string) => ({
    source: { id: "Kiosk", order_id: "17000000000001234" },
    payments: { type: getPaymentType(paymentType) },
    originalPayments: {
      cash: [],
      cards: [
        {
          detail: [{ otherName: getDetailedPaymentType(paymentType), amount: 9 }],
          totalAmount: 9,
          cardType: "Other",
        },
      ],
    },
  });

  it("accepts a payload built for the same Paytm type", () => {
    expect(isPaytmOrderDetailsConsistent(orderDetails("PaytmDynamicQr"), "PaytmDynamicQr")).toBe(true);
    expect(isPaytmOrderDetailsConsistent(orderDetails("PaytmEdc"), "PaytmEdc")).toBe(true);
    expect(orderDetails("PaytmDynamicQr").originalPayments.cards[0]?.detail[0]?.otherName).toBe("PaytmDynamicQR");
    expect(orderDetails("PaytmEdc").originalPayments.cards[0]?.detail[0]?.otherName).toBe("PaytmEDC");
  });

  it("refuses a stale COD payload, a missing tender block, the other gateway's tender, non-Paytm types", () => {
    const cod = { payments: { type: getPaymentType("PAY_AT_RESTAURANT") } };
    expect(cod.payments.type).toBe("COD");
    expect(isPaytmOrderDetailsConsistent(cod, "PaytmEdc")).toBe(false);
    expect(isPaytmOrderDetailsConsistent({ payments: { type: "ONLINE" } }, "PaytmEdc")).toBe(false);
    expect(isPaytmOrderDetailsConsistent(orderDetails("PaytmEdc"), "PaytmDynamicQr")).toBe(false);
    expect(isPaytmOrderDetailsConsistent(orderDetails("PaytmDynamicQr"), "PaytmEdc")).toBe(false);
    expect(isPaytmOrderDetailsConsistent(orderDetails("Geidea"), "Geidea")).toBe(false);
    const codTyped = { ...orderDetails("PaytmEdc"), payments: { type: "COD" } };
    expect(isPaytmOrderDetailsConsistent(codTyped, "PaytmEdc")).toBe(false);
  });

  it("junk → false, never a throw", () => {
    for (const junk of [
      null, undefined, "x", 42, [], { payments: "ONLINE" },
      { payments: { type: "ONLINE" }, originalPayments: { cards: "abc" } },
      { payments: { type: "ONLINE" }, originalPayments: { cards: [null] } },
    ]) {
      expect(isPaytmOrderDetailsConsistent(junk, "PaytmEdc")).toBe(false);
    }
  });
});

describe("readOpenPaytmSession (the real payment slice)", () => {
  const POS_BILL_NO = "17000000000001234";
  const POS_BILL_TIME = 1_700_000_000_000;
  const QR = "upi://pay?pa=e2e@paytm&am=9.00";
  type PaymentState = ReturnType<typeof paymentReducer>;
  const initial: PaymentState = paymentReducer(undefined, { type: "@@INIT" });
  const reduce = (...actions: { type: string }[]): PaymentState =>
    actions.reduce<PaymentState>((state, action) => paymentReducer(state, action), initial);
  const armed = (type: string, posBillTime: unknown = POS_BILL_TIME, posBillNo: unknown = POS_BILL_NO) =>
    reduce(setKioskPaymentType({ type }), setBillPaymentInfo({ posBillNo, posBillTime }));

  it("EDC: open from paymentType + posBillNo + posBillTime; qrCode is always ''", () => {
    expect(readOpenPaytmSession(armed("PaytmEdc"))).toEqual({
      kind: "paytmEdc", posBillNo: POS_BILL_NO, posBillTime: POS_BILL_TIME, qrCode: "",
    });
    const staleQr = paymentReducer(armed("PaytmEdc"), setPaytmQrCode(QR));
    expect(readOpenPaytmSession(staleQr)?.qrCode).toBe("");
  });

  it("DQR: open only with a QR", () => {
    expect(readOpenPaytmSession(armed("PaytmDynamicQr"))).toBeNull();
    expect(readOpenPaytmSession(paymentReducer(armed("PaytmDynamicQr"), setPaytmQrCode("  ")))).toBeNull();
    expect(readOpenPaytmSession(paymentReducer(armed("PaytmDynamicQr"), setPaytmQrCode(QR)))).toEqual({
      kind: "paytmDqr", posBillNo: POS_BILL_NO, posBillTime: POS_BILL_TIME, qrCode: QR,
    });
  });

  it("closed: initial state, after emptyPayment, COD, ids cleared by a failed initiate", () => {
    expect(readOpenPaytmSession(initial)).toBeNull();
    expect(readOpenPaytmSession(paymentReducer(armed("PaytmEdc"), emptyPayment()))).toBeNull();
    expect(readOpenPaytmSession(armed("PAY_AT_RESTAURANT"))).toBeNull();
    expect(readOpenPaytmSession(armed("PaytmEdc", "", ""))).toBeNull();
  });

  it("posBillTime: a numeric string is accepted; anything not finite and > 0 closes it", () => {
    expect(readOpenPaytmSession(armed("PaytmEdc", String(POS_BILL_TIME)))?.posBillTime).toBe(POS_BILL_TIME);
    for (const bad of ["", 0, -5, Number.NaN, Number.POSITIVE_INFINITY, "abc", null, true, {}, [5]]) {
      expect(readOpenPaytmSession(armed("PaytmEdc", bad))).toBeNull();
    }
  });

  it("each required field, removed from a raw open session, closes it (EDC never needs the QR)", () => {
    const rawEdc = { paymentType: "PaytmEdc", posBillNo: POS_BILL_NO, posBillTime: POS_BILL_TIME };
    const rawDqr = { ...rawEdc, paymentType: "PaytmDynamicQr", paytmQrCode: QR };
    expect(readOpenPaytmSession(rawEdc)).toEqual({ kind: "paytmEdc", posBillNo: POS_BILL_NO, posBillTime: POS_BILL_TIME, qrCode: "" });
    expect(readOpenPaytmSession(rawDqr)).toEqual({ kind: "paytmDqr", posBillNo: POS_BILL_NO, posBillTime: POS_BILL_TIME, qrCode: QR });
    const without = <T extends object>(raw: T, key: keyof T) => {
      const copy: Partial<T> = { ...raw };
      delete copy[key];
      return copy;
    };
    for (const key of ["paymentType", "posBillNo", "posBillTime"] as const) {
      expect(readOpenPaytmSession(without(rawEdc, key))).toBeNull();
    }
    for (const key of ["paymentType", "posBillNo", "posBillTime", "paytmQrCode"] as const) {
      expect(readOpenPaytmSession(without(rawDqr, key))).toBeNull();
    }
  });

  it("posBillNo must be a non-blank string; junk state → null", () => {
    for (const bad of ["", "   ", 17000, null]) {
      expect(readOpenPaytmSession(armed("PaytmEdc", POS_BILL_TIME, bad))).toBeNull();
    }
    for (const junk of [undefined, null, "payment", 42, []]) {
      expect(readOpenPaytmSession(junk)).toBeNull();
    }
  });
});

describe("status / void bodies are the verbatim builders", () => {
  const DEP = { _id: "dep1", tenant_id: "tenant1" };
  const POS_BILL_NO = "17000000000001234";
  const POS_BILL_TIME = 1_700_000_000_000;
  const session = (kind: PaytmKind): OpenPaytmSession => ({
    kind,
    posBillNo: POS_BILL_NO,
    posBillTime: POS_BILL_TIME,
    qrCode: kind === "paytmDqr" ? "upi://pay" : "",
  });
  const [dqrSel] = pickPaytmSelections([DQR_ENTITY]);
  const [edcSel] = pickPaytmSelections([EDC_ENTITY]);
  if (!dqrSel || !edcSel) throw new Error("fixture selections must be usable");

  it("DQR status body", () => {
    const body = buildPaytmKioskStatusBody(session("paytmDqr"), dqrSel, DEP);
    expect(body).toEqual(buildPaytmDqrKioskStatusPayload(DEP, POS_BILL_NO, "MID-E2E", "e2e-secret"));
    expect(body).toEqual({ deployment_id: "dep1", order_id: POS_BILL_NO, mid: "MID-E2E", secretKey: "e2e-secret" });
  });

  it("EDC status body", () => {
    const body = buildPaytmKioskStatusBody(session("paytmEdc"), edcSel, DEP);
    expect(body).toEqual(buildPaytmEdcKioskStatusPayload(DEP, POS_BILL_NO, POS_BILL_TIME, "EDC-E2E-1"));
    expect(body).toEqual({
      deployment_id: "dep1", order_id: POS_BILL_NO, posBillNo: POS_BILL_NO, posBillTime: POS_BILL_TIME, deviceId: "EDC-E2E-1",
    });
  });

  it("EDC void body", () => {
    const body = buildPaytmEdcVoidBody(session("paytmEdc"), edcSel, DEP);
    expect(body).toEqual(buildPaytmEdcKioskCancelPayload(DEP, POS_BILL_NO, POS_BILL_TIME, "EDC-E2E-1"));
    expect(body).toEqual({ deployment_id: "dep1", posBillNo: POS_BILL_NO, posBillTime: POS_BILL_TIME, deviceId: "EDC-E2E-1" });
  });
});

describe("classifyPaytmKioskPoll", () => {
  it("a {data} read goes through the verbatim classifier", () => {
    expect(classifyPaytmKioskPoll(ok({ status: "paid" }))).toBe("paid");
    expect(classifyPaytmKioskPoll(ok({ status: "cancelled" }))).toBe("cancelled");
    expect(classifyPaytmKioskPoll(ok({ status: "pending" }))).toBe("pending");
    expect(classifyPaytmKioskPoll(ok({ status: "PAID" }))).toBe("pending");
    expect(classifyPaytmKioskPoll(ok({}))).toBe("pending");
  });

  it("an error is NEVER pending (a pending read is what licenses an EDC void)", () => {
    for (const result of [
      TIMEOUT, MID_BODY_TIMEOUT, LOST_BODY, PROXY_HTML_502, FETCH,
      http(500), http(504), http(401), http(400),
      http(500, { status: "pending" }), http(500, { status: "paid" }),
      undefined, null, {}, "pending",
    ]) {
      expect(classifyPaytmKioskPoll(result)).toBe("error");
    }
  });
});

describe("classifyPaytmEdcVoidResult", () => {
  it("{data} through the verbatim classifier; {error} unknown vs error", () => {
    expect(classifyPaytmEdcVoidResult(ok({ success: true }))).toBe("voided");
    expect(classifyPaytmEdcVoidResult(ok({ status: "void_in_progress" }))).toBe("voidInProgress");
    expect(classifyPaytmEdcVoidResult(ok({ success: false }))).toBe("error");
    expect(classifyPaytmEdcVoidResult(http(400))).toBe("error");
    expect(classifyPaytmEdcVoidResult(undefined)).toBe("error");
    for (const result of [http(500), http(504), TIMEOUT, MID_BODY_TIMEOUT, LOST_BODY, FETCH]) {
      expect(classifyPaytmEdcVoidResult(result)).toBe("unknown");
    }
  });
});
