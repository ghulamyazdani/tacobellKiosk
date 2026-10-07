/**
 * P8b — Paytm Dynamic QR + Paytm EDC e2e mock surface (contract §P8b-16).
 *
 * `mockPaytmBackend(page, script?)` scripts the FIVE cx kiosk Paytm
 * endpoints and returns a live handle: per-endpoint request counts and parsed
 * bodies (the exactly-once assertions), the print-agent POST bodies, and how
 * many Paytm requests are still unanswered (the clock-stepping gate).
 *
 * ── MOCK ORDER (newest route wins) ──────────────────────────────────────
 *   1. the spec's `mockKioskBackend` — the `**\/api/**` catch-all FIRST;
 *   2. `mockCheckoutBackend(page, { extraDeviceSettings: [PAYTM_EDC_ENTITY,
 *      PAYTM_DQR_ENTITY] })` — the device settings that make the tiles real,
 *      plus FORBIDDEN_PATH_RE (500 + `forbiddenHit`) over every gateway
 *      prefix, and the aborted print agent;
 *   3. THIS helper, last — so its five routes beat FORBIDDEN_PATH_RE for
 *      exactly these five paths. The legacy `/api/payments/paytm*` family,
 *      `/api/cx/kiosk/createOrder` and any other `/api/cx/kiosk/paytm*` path
 *      stay forbidden: a regression to the legacy flow fails loudly.
 *
 * ── THE PRINT AGENT ─────────────────────────────────────────────────────
 * mockCheckoutBackend aborts https://localhost:65505 (no agent on a CI box).
 * The body is captured FIRST, on the page's `request` event: under the dev
 * server's StrictMode the simulated unmount of usePrintUtility aborts the
 * fetch client-side, usually before Playwright hands it to a route handler,
 * so a route-side capture would miss the one POST the page did send.
 *
 * ── THE STEPPING GATE (`inFlight()`) ────────────────────────────────────
 * RTK's per-request budgets (status 5 s, initiate/void 10 s) are fake-clock
 * timers. A spec that advances `page.clock` while a Paytm request is
 * unanswered can expire it mid-flight and turn a scripted answer into an
 * `error` read, so specs only advance the clock while `inFlight()` is 0. The
 * count lives IN the page (an init script wraps `fetch` for the five paths
 * only and passes every call through untouched): it changes synchronously
 * with the app's own fetch, so no CDP event latency can open a gap in it.
 *
 * Shapes verified against the SDK: endpoints
 * @cx-sdk/payments/services/paymentSettingsFetchApi.ts (initiatePaytmDqrKiosk …
 * cancelPaytmEdcKiosk), bodies @cx-sdk/payments/gateways/paytm.ts (the
 * build…Kiosk…Payload builders), entities = the Cockpit device-setting rows
 * (contract §1).
 */
import type { Page, Route } from "@playwright/test";
import type { JsonBody } from "./checkout";

/* ------------------------------------------------------------------ */
/* Configured gateways (real Cockpit entity shapes)                    */
/* ------------------------------------------------------------------ */

export const PAYTM_DQR_MID = "MID-E2E";
export const PAYTM_DQR_SECRET = "e2e-secret";
export const PAYTM_EDC_DEVICE_ID = "EDC-E2E-1";
/** The UPI intent string createQR answers with — what the QR encodes. */
export const PAYTM_QR = "upi://pay?pa=e2e@paytm&pn=TB&am=9.00&tr=E2E";

const paytmEntity = (
  type: "PaytmDynamicQr" | "PaytmEdc",
  fields: { id: string; label: string; value: string }[]
): JsonBody => ({
  _id: type === "PaytmEdc" ? "pay_edc" : "pay_dqr",
  tenant_id: "tenant1",
  deployment_id: "dep1",
  license_key: "mock-device-token",
  channel: "Kiosk",
  group: "payment",
  setting_label: type,
  setting_id: type,
  value: [
    { label: `Activate ${type}`, id: "activate", value: true, fieldType: "checkbox" },
    ...fields.map((field) => ({ ...field, fieldType: "text" })),
  ],
});

/** getKisokDeviceData row for Paytm Dynamic QR (Cockpit cx_configuration). */
export const PAYTM_DQR_ENTITY = paytmEntity("PaytmDynamicQr", [
  { label: "paytm_dqr_merchant_guid", id: "paytm_dqr_merchant_guid", value: PAYTM_DQR_MID },
  { label: "paytm_dqr_secret_key", id: "paytm_dqr_secret_key", value: PAYTM_DQR_SECRET },
]);

/** getKisokDeviceData row for Paytm EDC (the terminal id only — MID/secret live server-side). */
export const PAYTM_EDC_ENTITY = paytmEntity("PaytmEdc", [
  { label: "Device Id", id: "paytm_device_id", value: PAYTM_EDC_DEVICE_ID },
]);

/* ------------------------------------------------------------------ */
/* The five kiosk endpoints                                            */
/* ------------------------------------------------------------------ */

export const PAYTM_ENDPOINTS = {
  dqrInit: "**/api/cx/kiosk/paytmDynamicQR/createQR",
  dqrStatus: "**/api/cx/kiosk/paytmDynamicQR/checkStatus",
  edcInit: "**/api/cx/kiosk/paytmEDC/initiate",
  edcStatus: "**/api/cx/kiosk/paytmEDC/checkStatus",
  edcCancel: "**/api/cx/kiosk/paytmEDC/cancel",
} as const;

export type PaytmEndpoint = keyof typeof PAYTM_ENDPOINTS;

const ENDPOINT_NAMES = Object.keys(PAYTM_ENDPOINTS) as PaytmEndpoint[];

/** Same five paths, for the in-page in-flight count. */
const PAYTM_PATH_RE =
  /\/api\/cx\/kiosk\/(?:paytmDynamicQR\/(?:createQR|checkStatus)|paytmEDC\/(?:initiate|checkStatus|cancel))(?:[?#]|$)/;

const PRINT_AGENT_PREFIX = "https://localhost:65505/";

/* ------------------------------------------------------------------ */
/* Request bodies (what the assertions read)                           */
/* ------------------------------------------------------------------ */

/** The parked order (useOrderHook.getPushOrderData → toPush). */
export interface PaytmOrderDetails {
  payments?: { type?: string };
  source?: { order_id?: string };
  originalPayments?: { cards?: { detail?: { otherName?: string }[] }[] };
}

export interface DqrInitBody {
  payload: {
    mid: string;
    orderId: string;
    amount: number;
    businessType: string;
    expiryDate: string;
    posId: string;
  };
  secretKey: string;
  deployment_id: string;
  tenant_id: string;
  mid: string;
  posBillId: string;
  order_details: PaytmOrderDetails;
}

export interface DqrStatusBody {
  deployment_id: string;
  order_id: string;
  mid: string;
  secretKey: string;
}

export interface EdcInitBody {
  deployment_id: string;
  posBillNo: string;
  posBillTime: number;
  billId: string;
  amount: number;
  _customer: { phone: string };
  deviceId: string;
  order_details: PaytmOrderDetails;
}

export interface EdcStatusBody {
  deployment_id: string;
  order_id: string;
  posBillNo: string;
  posBillTime: number;
  deviceId: string;
}

export interface EdcCancelBody {
  deployment_id: string;
  posBillNo: string;
  posBillTime: number;
  deviceId: string;
}

export interface PaytmBodies {
  dqrInit: DqrInitBody[];
  dqrStatus: DqrStatusBody[];
  edcInit: EdcInitBody[];
  edcStatus: EdcStatusBody[];
  edcCancel: EdcCancelBody[];
}

/* ------------------------------------------------------------------ */
/* Scripted responses                                                  */
/* ------------------------------------------------------------------ */

/** `body` (raw text) wins over `json`; status defaults to 200. */
export interface PaytmReply {
  status?: number;
  json?: unknown;
  body?: string;
}

/** `call` is 1-based for its endpoint; the handle exposes every count. */
export type PaytmResponder = (call: number, handle: PaytmMockHandle) => PaytmReply;

export type PaytmScript = Partial<Record<PaytmEndpoint, PaytmResponder>>;

export type PaytmPollStatus = "pending" | "paid" | "cancelled";

/** A checkStatus answer (classifier: "paid" / "cancelled" / anything else pending). */
export const paytmStatus = (status: PaytmPollStatus): PaytmReply => ({ json: { status } });

/** Status answers in order; the last one repeats forever. */
export const statusSequence =
  (...sequence: PaytmPollStatus[]): PaytmResponder =>
  (call) =>
    paytmStatus(sequence[Math.min(call, sequence.length) - 1]);

/**
 * A 2xx whose body never parses (RTK PARSING_ERROR with originalStatus 200):
 * the request may well have armed the terminal — outcome UNKNOWN.
 */
export const LOST_BODY: PaytmReply = { status: 200, body: "not-json" };

/** The terminal's open-transaction refusal (classifier: "busy"). */
export const EDC_BUSY: PaytmReply = {
  status: 400,
  json: { msg: "Multiple payment request not allowed" },
};

export const httpError = (status: number): PaytmReply => ({
  status,
  json: { msg: `scripted ${status}` },
});

/** Happy defaults: a QR, an armed terminal, "pending" forever, a delivered void. */
const DEFAULT_SCRIPT: Record<PaytmEndpoint, PaytmResponder> = {
  dqrInit: () => ({ json: { qrCode: PAYTM_QR } }),
  dqrStatus: () => paytmStatus("pending"),
  edcInit: () => ({
    json: { success: true, traceId: "t1", parkedOrder: {}, paytmResponse: {} },
  }),
  edcStatus: () => paytmStatus("pending"),
  edcCancel: () => ({ json: { success: true } }),
};

/* ------------------------------------------------------------------ */
/* Handle + helper                                                     */
/* ------------------------------------------------------------------ */

export interface PaytmMockHandle {
  /** Requests that reached each route — the exactly-once counts. */
  readonly counts: Record<PaytmEndpoint, number>;
  /** Parsed request bodies per endpoint, in arrival order. */
  readonly bodies: PaytmBodies;
  /** All five counts summed — 0 means the kiosk never talked to Paytm. */
  readonly total: number;
  /** Responders, read at request time — reassign one to change the script mid-test. */
  script: PaytmScript;
  /** Paytm fetches the page started whose response body is not read yet. */
  inFlight: () => Promise<number>;
  /** Every POST body the page sent to the print agent (captured before the abort). */
  readonly printBodies: string[];
}

interface PaytmWindow {
  __paytmInFlight?: number;
}

const parseBody = (route: Route): unknown => {
  try {
    return route.request().postDataJSON() ?? {};
  } catch {
    return {};
  }
};

/**
 * Register the five Paytm kiosk routes. Call AFTER `mockKioskBackend` and
 * `mockCheckoutBackend` — see the header.
 */
export async function mockPaytmBackend(
  page: Page,
  script: PaytmScript = {}
): Promise<PaytmMockHandle> {
  const bodies: PaytmBodies = {
    dqrInit: [],
    dqrStatus: [],
    edcInit: [],
    edcStatus: [],
    edcCancel: [],
  };
  const printBodies: string[] = [];

  const handle: PaytmMockHandle = {
    get counts() {
      return {
        dqrInit: bodies.dqrInit.length,
        dqrStatus: bodies.dqrStatus.length,
        edcInit: bodies.edcInit.length,
        edcStatus: bodies.edcStatus.length,
        edcCancel: bodies.edcCancel.length,
      };
    },
    bodies,
    get total() {
      return ENDPOINT_NAMES.reduce((sum, name) => sum + bodies[name].length, 0);
    },
    script: { ...script },
    inFlight: () =>
      page.evaluate(
        () => (window as unknown as PaytmWindow).__paytmInFlight ?? 0
      ),
    printBodies,
  };

  page.on("request", (request) => {
    if (request.url().startsWith(PRINT_AGENT_PREFIX) && request.method() === "POST") {
      printBodies.push(request.postData() ?? "");
    }
  });

  // The stepping gate (header): +1 when the app starts a Paytm fetch, -1 once
  // its body has been read or the call failed. The app gets the original
  // promise back, untouched.
  await page.addInitScript((pathSource) => {
    const paytmPath = new RegExp(pathSource);
    const w = window as unknown as PaytmWindow;
    w.__paytmInFlight = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!paytmPath.test(url)) return originalFetch(input, init);
      w.__paytmInFlight = (w.__paytmInFlight ?? 0) + 1;
      const response = originalFetch(input, init);
      void response
        .then((r) => r.clone().arrayBuffer())
        .catch(() => undefined)
        .finally(() => {
          w.__paytmInFlight = (w.__paytmInFlight ?? 1) - 1;
        });
      return response;
    };
  }, PAYTM_PATH_RE.source);

  for (const name of ENDPOINT_NAMES) {
    await page.route(PAYTM_ENDPOINTS[name], (route) => {
      const received = bodies[name] as unknown[];
      received.push(parseBody(route));
      const reply = (handle.script[name] ?? DEFAULT_SCRIPT[name])(
        received.length,
        handle
      );
      if (reply.body !== undefined) {
        return route.fulfill({
          status: reply.status ?? 200,
          contentType: "application/json",
          body: reply.body,
        });
      }
      return route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
    });
  }

  return handle;
}
