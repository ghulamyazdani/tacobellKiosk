/**
 * P8a — checkout / PAY AT COUNTER / order-push e2e mock surface.
 *
 * `mockCheckoutBackend(page, opts?)` registers every network edge the
 * pay-at-counter vertical touches (and every edge it MUST NOT touch) and
 * returns a live handle the spec asserts on.
 *
 * ── HOUSE MOCK ORDER ────────────────────────────────────────────────────
 * Playwright matches routes NEWEST-FIRST. bag.spec.ts:73-126 registers the
 * catch-all `**\/api/**` FIRST and every specific mock after it, so this
 * helper MUST be called AFTER `mockKioskBackend(page)` or the catch-all `{}`
 * swallows placeOrder, getKisokDeviceData and friends. Inside this file the
 * same rule applies top-to-bottom: the broad FORBIDDEN matcher is registered
 * first and every allowed, specific endpoint after it.
 *
 * ── WHY THE 500 GUARDS EXIST (brief §SAFETY) ────────────────────────────
 * The `**\/api/**` catch-all answers `{}` with HTTP 200. That makes a
 * regression that reaches a payment gateway look like a *pass*: the call
 * resolves, nothing throws, the flow continues. So every gateway prefix and
 * the backend-ordering `placeOrder` variant get an explicit 500-fulfilling
 * route plus a flag. `handle.forbiddenHit` must stay `false` in every P8a
 * spec — assert it.
 *
 * ── URLS: VERIFIED AGAINST THE SDK SOURCE, NOT THE BRIEF ────────────────
 * Every path below was read out of the real service definitions in
 * posistKiosk-cx-sdk/packages (see the per-route comments for the file and
 * line). Corrections to the brief are called out inline with "BRIEF NOTE".
 */
import type { Page, Route } from "@playwright/test";

export type JsonBody = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Endpoint constants (all verified in the SDK)                        */
/* ------------------------------------------------------------------ */

/**
 * The ONLY order-placing call this vertical is allowed to make.
 * @cx-sdk/ordering/services/orderApi.ts:21 — `pushOnlineOrder`,
 * POST /api/onlineOrders/partner/kiosk/placeOrder.
 */
export const PLACE_ORDER_URL = "**/api/onlineOrders/partner/kiosk/placeOrder";

/**
 * The backend-ordering variant — orderApi.ts:41, `placeByBackendOrdering`,
 * POST /api/cx/kiosk/placeOrder. Reached ONLY when `payment.paymentType` is
 * Geidea / NeoLeap / Dojo (useOrderHook.pushOrder's three-way switch). If a
 * P8a spec ever hits it, the PAY_AT_RESTAURANT string broke — hence 500.
 */
export const BACKEND_ORDERING_URL = "**/api/cx/kiosk/placeOrder";

/** Device/payment settings blob — @cx-sdk/payments/services/paymentSettingsFetchApi.ts:28. */
export const DEVICE_DATA_URL = "**/api/cx/getKisokDeviceData";

/** Deployment payment partners — @cx-sdk/payments/services/paymentInfoApi.ts:23. */
export const PAYMENT_PARTNERS_URL =
  "**/api/cx/kiosk/getDeploymentPaymentPartners";

/** Deployment ordering settings — @cx-sdk/catalog/services/settingsApi.ts:30. */
export const DEPLOYMENT_SETTINGS_URL = "**/api/cx/kiosk/getDeploymentSettings";

/** Pipelines — overridden here only to flip `tab_type` (see opts.tabType). */
export const PIPELINES_URL = "**/api/cx/kiosk/getPipelines";

/**
 * The local print agent. DIFFERENT ORIGIN — `**\/api/**` does NOT cover it,
 * and an unrouted cross-origin request hangs. @cx-sdk/devices/printer/
 * ticketFormat.ts:17,28 and packages/devices/README.md:17 both name
 * `https://localhost:65505/api/printer`.
 */
export const PRINT_AGENT_ORIGIN = "https://localhost:65505/**";

/**
 * Terminal-socket origins the three peripheral services use (geidea
 * ws://localhost:5000, neoLeap ws://localhost:7000, mashreq
 * https://localhost:5000/EFTTransact). None of them is ported into TB — these
 * guards exist so that if one ever is, the spec says so out loud. `page.route`
 * cannot intercept a raw WebSocket handshake, so this only catches the
 * https/fetch flavours (Mashreq). Documented, not silently relied upon.
 */
export const TERMINAL_ORIGINS = [
  "https://localhost:5000/**",
  "https://localhost:7000/**",
] as const;

/**
 * Every gateway path prefix, read off the SDK service definitions:
 *   pinelabs            paymentSettingsFetchApi.ts:35,42,49   /api/cx/pinelabs/*
 *   paytm (hosted QR)   paymentSettingsFetchApi.ts:56,63      /api/payments/paytmDynamicQR/*
 *   paytm (EDC)         paymentSettingsFetchApi.ts:70,85,112  /api/payments/paytmEdc/*
 *   paytm (kiosk)       paymentSettingsFetchApi.ts:152-188    /api/cx/kiosk/paytmDynamicQR/*, /paytmEDC/*
 *   paytm order create  paymentSettingsFetchApi.ts:139        /api/cx/kiosk/createOrder
 *   razorpay            paymentSettingsFetchApi.ts:196-250,
 *                       razorpayApi.ts:20,27                  /api/payments/razorpay/*
 *   networkinternational paymentSettingsFetchApi.ts:277-313   /api/payments/networkinternationalv2/*
 *   ni (park)           paymentSettingsFetchApi.ts:359        /api/cx/kiosk/ni/*
 *   dojo                paymentSettingsFetchApi.ts:320-348    /api/cx/kiosk/dojo/*
 *   settlement poll     paymentSettingsFetchApi.ts:366        /api/cx/kiosk/paymentSettlement/*
 *   QR partner status   paymentInfoApi.ts:16                  /api/partners/getPartnerStatusForQR
 *
 * BRIEF NOTE (correction): the brief says "networkinternational"; the real
 * path is `networkinternationalv2` — the matcher below uses the `v2`-tolerant
 * `networkinternational` stem so both spellings are caught. The brief's "ni"
 * is a SEPARATE route family (`/api/cx/kiosk/ni/initiateAndPark`), not an
 * abbreviation of it; both are covered.
 *
 * BRIEF NOTE (addition): `/api/cx/kiosk/createOrder`, `/api/cx/kiosk/
 * paymentSettlement/status` and `/api/partners/getPartnerStatusForQR` are not
 * named in the brief but are gateway-side endpoints in the same SDK files, so
 * they are guarded too.
 */
export const FORBIDDEN_PATH_RE =
  /\/api\/(?:cx\/pinelabs\/|payments\/paytm|cx\/kiosk\/paytm|cx\/kiosk\/createOrder|payments\/razorpay\/|payments\/networkinternational|cx\/kiosk\/ni\/|cx\/kiosk\/dojo\/|cx\/kiosk\/paymentSettlement|partners\/getPartnerStatusForQR)/i;

/* ------------------------------------------------------------------ */
/* Default response bodies                                             */
/* ------------------------------------------------------------------ */

/**
 * `pushOnlineOrder(...).unwrap()` in useOrderHook.pushOrder:178 discards the
 * response — only rejection matters. The body is therefore only plausible,
 * not load-bearing; it exists so a spec can log something meaningful.
 */
export const PLACE_ORDER_OK: JsonBody = {
  status: true,
  message: "Order placed successfully",
  data: { order_status: "PENDING" },
};

/**
 * No Mashreq partner ⇒ `findMashreqPartner` (@cx-sdk/payments/gateways/
 * paymentOptions.ts:53) returns undefined ⇒ no synthetic Mashreq option is
 * prepended and no bridge probe is attempted.
 */
export const NO_PAYMENT_PARTNERS: JsonBody = { paymentPartners: [] };

/**
 * getKisokDeviceData entity shape — @cx-sdk/payments/gateways/paymentOptions.ts
 * `Entity` (`group`/`channel` drive filterPaymentOptions; everything with
 * `group: "general"` lands in `generalSettings`). The general-settings readers
 * in @cx-sdk/catalog/settings/settingsEngine.ts (getPrintBillSetting:323,
 * getPrintBillPosSetting:337) and BrandWrapper's tent range check
 * (src/components/common/wrapper/BrandWrapper.tsx:160-172) all read
 * `value.value`, and BrandWrapper additionally requires
 * `channel === "Kiosk" && group === "general"` — so both are always set.
 */
export interface DeviceSettingEntity extends JsonBody {
  _id: string;
  setting_id: string;
  group: string;
  channel: string;
  value: { value: unknown };
}

const generalSetting = (
  settingId: string,
  value: unknown
): DeviceSettingEntity => ({
  _id: `general_${settingId}`,
  deployment_id: "dep1",
  license_key: "mock-device-token",
  tenant_id: "tenant1",
  setting_label: settingId,
  setting_id: settingId,
  group: "general",
  channel: "Kiosk",
  value: { value },
});

/* ------------------------------------------------------------------ */
/* Options + handle                                                    */
/* ------------------------------------------------------------------ */

export interface CheckoutMockOptions {
  /**
   * Add the "disable COD" deployment-settings entity, so
   * `checkIfCODAvailable` returns false and `/payment` renders
   * `payment-unavailable` (P8a has zero gateways by construction).
   * Carries BOTH key spellings — see DISABLE_COD_DIVERGENCE below.
   */
  codDisabled?: boolean;
  /**
   * Pipeline `tab_type`. "table" is what routes PAY through `/tent`
   * (verified: ORIG BillSection.tsx:8,23,119 / CustomerName.tsx:119 /
   * CustomerPhone.tsx:134 all compare against the literal "table").
   * Default "dine_in", matching bag.spec.ts's pipeline mock.
   */
  tabType?: string;
  /**
   * tent_number_range bounds. Default {from:1,to:99}. Pass `null` to omit the
   * entity entirely — that is the "unconfigured tent" case the brief requires
   * TB to survive instead of dead-ending the customer.
   */
  tentRange?: { from: number; to: number } | null;
  /** `print_bill` general setting. Default false — nothing may print. */
  printBill?: boolean;
  /** `enable_printing_via_pos` general setting. Default false. */
  printViaPos?: boolean;
  /**
   * Fulfil the first N `pushOnlineOrder` calls with HTTP 500 so the spec can
   * drive the settlement retry ladder (ORDER_PUSH_MAX_ATTEMPTS = 4) and the
   * `order-error` terminal state. Calls beyond N succeed, which is how the
   * "Retry succeeds → /orderSuccess" leg is exercised. Default 0.
   */
  failPlaceOrderTimes?: number;
  /** Override the placeOrder success body. */
  placeOrderResponse?: JsonBody;
  /** Extra entities appended to the getKisokDeviceData array. */
  extraDeviceSettings?: JsonBody[];
  /** Replace the getDeploymentSettings array outright (wins over codDisabled). */
  deploymentSettings?: JsonBody[];
}

/** Live counters — read them after the interaction under test. */
export interface CheckoutMockHandle {
  /** How many times the allowed placeOrder endpoint fired. Happy path: 1. */
  placeOrderCount: number;
  /** Parsed request bodies, in order. Assert `payments.type === "COD"` here. */
  placeOrderBodies: unknown[];
  /** The most recent placeOrder request body (undefined before the first). */
  lastPlaceOrderBody: unknown;
  /** How many of those were answered 500 (see opts.failPlaceOrderTimes). */
  placeOrderFailures: number;
  /**
   * MUST STAY FALSE. True the moment any gateway prefix, the backend-ordering
   * placeOrder, or a terminal-socket origin is requested.
   */
  forbiddenHit: boolean;
  /** Every forbidden URL that was requested, in order (for the failure message). */
  forbiddenUrls: string[];
  /** MUST STAY FALSE. True if anything reached https://localhost:65505. */
  printAgentContacted: boolean;
  /** Every print-agent URL requested, in order. */
  printAgentUrls: string[];
  /** Settings-fetch hit counts (boot wiring assertions). */
  deviceDataCount: number;
  paymentPartnersCount: number;
  deploymentSettingsCount: number;
}

/**
 * ⚠️ `checkIfCODAvailable` DIVERGENCE — the fixture carries BOTH spellings on
 * purpose (brief §payment).
 *
 *  - SDK (@cx-sdk/payments/gateways/paymentOptions.ts:117-137 — the
 *    maintained surface P8a uses) matches `entity.label === "Disable COD for
 *    Kiosk"` and `tabs[].tabLabel`, and disables COD as soon as the current
 *    tab appears in `tabs`.
 *  - Page-local (ORIG src/pages/PaymentSelection.tsx:66-92 — what actually
 *    ships in the fork) matches `entity.name === "disable_cod_kiosk"` and
 *    `tabs[].tabType`, AND additionally requires `tabSetting.selected === true`
 *    before it disables COD. It also folds "take_out"/"takeout" together.
 *
 * So the entity below sets `name` + `label`, each tab row sets `tabType` +
 * `tabLabel` + `selected: true`, and take-out rows are emitted under both
 * spellings. Result: the fixture disables COD under EITHER implementation, so
 * a later swap between them cannot silently change what the spec proves.
 */
const disableCodEntity = (tabType: string): JsonBody => {
  const raw = tabType.toLowerCase();
  const tabValues =
    raw === "take_out" || raw === "takeout" ? ["take_out", "takeout"] : [raw];

  return {
    _id: "disable_cod_kiosk_1",
    // page-local key spelling ↓
    name: "disable_cod_kiosk",
    // SDK key spelling ↓
    label: "Disable COD for Kiosk",
    tabs: tabValues.map((value) => ({
      tabType: value, // page-local
      tabLabel: value, // SDK
      selected: true, // page-local only; SDK ignores it
    })),
  };
};

const parseBody = (route: Route): unknown => {
  try {
    return route.request().postDataJSON();
  } catch {
    return undefined;
  }
};

/* ------------------------------------------------------------------ */
/* The helper                                                          */
/* ------------------------------------------------------------------ */

/**
 * Register the whole P8a checkout surface. Call AFTER the spec's
 * `mockKioskBackend(page)` — newest route wins.
 *
 * Typical use:
 * ```ts
 * await mockKioskBackend(page);
 * const checkout = await mockCheckoutBackend(page);
 * // ... drive the flow ...
 * expect(checkout.placeOrderCount).toBe(1);
 * expect(checkout.lastPlaceOrderBody).toMatchObject({ payments: { type: "COD" } });
 * expect(checkout.forbiddenHit).toBe(false);
 * expect(checkout.printAgentContacted).toBe(false);
 * ```
 */
export async function mockCheckoutBackend(
  page: Page,
  opts: CheckoutMockOptions = {}
): Promise<CheckoutMockHandle> {
  const tabType = opts.tabType ?? "dine_in";
  const tentRange =
    opts.tentRange === undefined ? { from: 1, to: 99 } : opts.tentRange;
  const failTimes = opts.failPlaceOrderTimes ?? 0;

  const handle: CheckoutMockHandle = {
    placeOrderCount: 0,
    placeOrderBodies: [],
    lastPlaceOrderBody: undefined,
    placeOrderFailures: 0,
    forbiddenHit: false,
    forbiddenUrls: [],
    printAgentContacted: false,
    printAgentUrls: [],
    deviceDataCount: 0,
    paymentPartnersCount: 0,
    deploymentSettingsCount: 0,
  };

  const denyLoudly = (route: Route) => {
    handle.forbiddenHit = true;
    handle.forbiddenUrls.push(route.request().url());
    return route.fulfill({
      status: 500,
      json: {
        error:
          "FORBIDDEN IN P8a: pay-at-counter must never reach a payment gateway or terminal.",
        url: route.request().url(),
      },
    });
  };

  // ---- FORBIDDEN, registered FIRST so the allowed routes below win ----

  // Every gateway prefix in one matcher (see FORBIDDEN_PATH_RE for the
  // per-prefix SDK citations).
  await page.route(FORBIDDEN_PATH_RE, denyLoudly);

  // The backend-ordering placeOrder — only reachable if paymentType stopped
  // being "PAY_AT_RESTAURANT" (useOrderHook.pushOrder's Geidea/NeoLeap/Dojo
  // branch). Distinct path from PLACE_ORDER_URL, so no shadowing.
  await page.route(BACKEND_ORDERING_URL, denyLoudly);

  // Mashreq's https bridge and the terminal origins. Cross-origin, so the
  // `**/api/**` catch-all never saw them. (Raw ws:// handshakes are outside
  // page.route's reach — see TERMINAL_ORIGINS.)
  for (const origin of TERMINAL_ORIGINS) {
    await page.route(origin, denyLoudly);
  }

  // ---- The local print agent: different origin, always aborted ----
  // Aborting (not fulfilling) mirrors "no print agent on this machine", which
  // is the state every CI box is in. usePrintUtility must swallow it.
  await page.route(PRINT_AGENT_ORIGIN, (route) => {
    handle.printAgentContacted = true;
    handle.printAgentUrls.push(route.request().url());
    return route.abort("failed");
  });

  // ---- ALLOWED endpoints, registered after the guards ----

  // Pipelines: same row bag.spec.ts serves, with tab_type swappable so PAY can
  // be routed through /tent.
  await page.route(PIPELINES_URL, (route) =>
    route.fulfill({
      json: [
        {
          _id: "p1",
          tab_id: "t1",
          tab_type: tabType,
          primary_name: tabType === "table" ? "Table Service" : "Dine In",
        },
      ],
    })
  );

  // Device settings. Consumed as `fetchPaymentMethod?.data` (ORIG
  // usePaymentHook.ts:280-292) → a bare ARRAY of entities, not an envelope.
  await page.route(DEVICE_DATA_URL, (route) => {
    handle.deviceDataCount += 1;
    const entities: JsonBody[] = [
      generalSetting("print_bill", opts.printBill ?? false),
      generalSetting("enable_printing_via_pos", opts.printViaPos ?? false),
      ...(tentRange ? [generalSetting("tent_number_range", tentRange)] : []),
      ...(opts.extraDeviceSettings ?? []),
    ];
    return route.fulfill({ json: entities });
  });

  // No partners ⇒ no Mashreq bridge probe.
  await page.route(PAYMENT_PARTNERS_URL, (route) => {
    handle.paymentPartnersCount += 1;
    return route.fulfill({ json: NO_PAYMENT_PARTNERS });
  });

  // Deployment ordering settings. Default: NO disable_cod_kiosk entity, so
  // checkIfCODAvailable returns true (both implementations return true when
  // the setting is absent) and the PAY AT COUNTER tile renders.
  await page.route(DEPLOYMENT_SETTINGS_URL, (route) => {
    handle.deploymentSettingsCount += 1;
    const settings: JsonBody[] =
      opts.deploymentSettings ??
      (opts.codDisabled ? [disableCodEntity(tabType)] : []);
    return route.fulfill({ json: settings });
  });

  // The one and only order push. Registered LAST so nothing can shadow it.
  await page.route(PLACE_ORDER_URL, (route) => {
    handle.placeOrderCount += 1;
    const body = parseBody(route);
    handle.placeOrderBodies.push(body);
    handle.lastPlaceOrderBody = body;

    if (handle.placeOrderCount <= failTimes) {
      handle.placeOrderFailures += 1;
      return route.fulfill({
        status: 500,
        json: { status: false, message: "Order not placed" },
      });
    }
    return route.fulfill({ json: opts.placeOrderResponse ?? PLACE_ORDER_OK });
  });

  return handle;
}
