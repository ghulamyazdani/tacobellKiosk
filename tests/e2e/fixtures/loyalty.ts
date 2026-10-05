/**
 * P7c — Xeno loyalty e2e mock surface.
 *
 * `mockXenoLoyalty(page, opts?)` registers every network edge the Xeno flow
 * touches and returns a live handle the spec can assert on (revoke counter,
 * per-event call counts, the request payloads).
 *
 * HOUSE MOCK ORDER (bag.spec.ts / pack.spec.ts): Playwright matches routes
 * NEWEST-FIRST, and those specs register a catch-all `**\/api/**` FIRST and
 * every specific mock after it. So `mockXenoLoyalty` MUST be called AFTER
 * `mockKioskBackend(page)` or the catch-all `{}` swallows the partner and
 * execute_event calls.
 *
 * Two traps this file exists to close (contract §TRAPS):
 * - trap 7: all five loyalty operations share ONE url
 *   (`POST /api/partners/execute_event?deployment_id=…&event_name=…`), so the
 *   handler branches on the `event_name` QUERY PARAM, not on the path.
 * - trap 6: the revoke is a raw cross-origin `fetch` to
 *   `https://xeno.in:2223/...` — the `**\/api/**` catch-all does NOT cover it
 *   and an unrouted request hangs forever (no timeout in the hook). It gets
 *   its own origin-scoped route here, plus a counter so specs can assert it
 *   fired (and fired BEFORE the session reset).
 *
 * FAILURE BODIES ARE HTTP 200. The loyalty proxy wraps the real outcome in the
 * body (`{status_code: 400, response: {message}}`) — see
 * @cx-sdk/ordering/loyalty/loyaltyRedemption file header. A real HTTP 400 would
 * make RTK Query return `{error}` and `useLoyalty.validateCoupon` /
 * `redeemLoyaltyPoints` / `finalLoyaltyRedemption` read `response?.data` as
 * undefined — the partner message would never reach the error modal. So every
 * `fail*` body below is fulfilled with status 200 and an embedded
 * `status_code: 400`, which is what the gateway actually does.
 *
 * COUPON→MENU JOIN (verified against tests/e2e/fixtures/slim-menu.json):
 * `getAllLoyaltyItemsFromMenu` keys rewards by `coupon.products[]._id`, merges
 * the matching top-level menu entity over them, then SILENTLY DROPS any reward
 * whose merged `price` is falsy or whose `image_url` is null/"undefined". All
 * three ids below resolve to real slim-menu entities with a price and an image:
 *   static6562 Free Greek Salad        → 5dd1093829754a432f2c32e2 Greek Salad  £17, 0 modifier groups, 100% → Free,  3000 pts
 *   static8055 Free Large Fries        → 5dd10938eb1ccee31ca352fa Large Fries  £9,  1 modifier group,  100% → Free,  2000 pts
 *   static8056 Half-price Cheese Burger→ 5dd10936712f5b622a66aab7 Cheese Burger £8, 3 modifier groups, 50%  → 50% off, 1000 pts
 * (Greek Salad is the modifier-free one — use it for the plain redemption path;
 * Cheese Burger exercises the customizable-reward path.)
 */
import type { Page, Route } from "@playwright/test";

/** The five operations multiplexed over /api/partners/execute_event. */
export type XenoEventName =
  | "check_loyalty_balance"
  | "validate_coupon"
  | "authenticate_redemption"
  | "redeem_coupon"
  | "redeem_points";

export type JsonBody = Record<string, unknown>;

/** Loyalty coupon as check_loyalty_balance returns it. */
export interface XenoCoupon {
  coupon_name: string;
  coupon_code: string;
  discount_on: string;
  discount_type: string;
  discount_value: number;
  special_offer: boolean;
  item_options: Record<string, unknown>;
  products: Array<{ _id: string; quantity: number }>;
  extra_fields: Array<{ name: string; value: string | number }>;
}

// ---- slim-menu entity ids the rewards join onto (see header) ----
export const GREEK_SALAD_ID = "5dd1093829754a432f2c32e2";
export const LARGE_FRIES_ID = "5dd10938eb1ccee31ca352fa";
export const CHEESE_BURGER_ID = "5dd10936712f5b622a66aab7";

/** The number the phone screen is driven with; matches CUSTOMER_NAME_ROWS. */
export const LOYALTY_PHONE = "9953833675";
/** The 4 digits redeem_coupon accepts in the happy path. */
export const LOYALTY_OTP = "1234";

/** POST /api/cx/kiosk/getLoyaltyPartner — Xeno (i.e. NOT "reelo"). */
export const LOYALTY_PARTNER = {
  partner: {
    partner_name: "Xeno",
    customer_key: "xeno-customer-key-1",
    partner_merchant_id: "xeno-merchant-uuid-1",
    partner_merchant_username: "kiosk@xeno.in",
  },
  partnerDetails: {
    client_id: "xeno-client-1",
    partner_name: "Xeno",
  },
};

export const LOYALTY_COUPONS: XenoCoupon[] = [
  {
    coupon_name: "Free Greek Salad",
    coupon_code: "static6562",
    discount_on: "item",
    discount_type: "percentage",
    discount_value: 100,
    special_offer: false,
    item_options: {},
    products: [{ _id: GREEK_SALAD_ID, quantity: 1 }],
    extra_fields: [
      { name: "Points Value", value: 3000 },
      { name: "Reward Type", value: "Loyalty Reward" },
    ],
  },
  {
    coupon_name: "Free Large Fries",
    coupon_code: "static8055",
    discount_on: "item",
    discount_type: "percentage",
    discount_value: 100,
    special_offer: false,
    item_options: {},
    products: [{ _id: LARGE_FRIES_ID, quantity: 1 }],
    extra_fields: [
      { name: "Points Value", value: 2000 },
      { name: "Reward Type", value: "Loyalty Reward" },
    ],
  },
  {
    coupon_name: "Half-price Cheese Burger",
    coupon_code: "static8056",
    discount_on: "item",
    discount_type: "percentage",
    discount_value: 50,
    special_offer: false,
    item_options: {},
    products: [{ _id: CHEESE_BURGER_ID, quantity: 1 }],
    extra_fields: [
      { name: "Points Value", value: 1000 },
      { name: "Reward Type", value: "Loyalty Reward" },
    ],
  },
];

/**
 * Quick lookup for assertions: what each reward should render as after the
 * menu join (prices are the slim-menu entity prices, pre-tax).
 */
export const LOYALTY_REWARDS = {
  greekSalad: {
    couponCode: "static6562",
    entityId: GREEK_SALAD_ID,
    name: "Greek Salad",
    price: 17,
    points: 3000,
    discountType: "percentage",
    discountValue: 100,
    hasModifiers: false,
  },
  largeFries: {
    couponCode: "static8055",
    entityId: LARGE_FRIES_ID,
    name: "Large Fries",
    price: 9,
    points: 2000,
    discountType: "percentage",
    discountValue: 100,
    hasModifiers: true,
  },
  cheeseBurger: {
    couponCode: "static8056",
    entityId: CHEESE_BURGER_ID,
    name: "Cheese Burger",
    price: 8,
    points: 1000,
    discountType: "percentage",
    discountValue: 50,
    hasModifiers: true,
  },
} as const;

/** Starting balance; one 3000-pt redemption leaves 3000. */
export const LOYALTY_POINTS_TOTAL = 6000;

export const CHECK_LOYALTY_BALANCE_OK = {
  status_code: 200,
  response: {
    loyalty_points: LOYALTY_POINTS_TOTAL,
    total_redeemable_points: LOYALTY_POINTS_TOTAL,
    min_bill_for_redemption: 0,
    coupons: LOYALTY_COUPONS,
  },
};

/** The "no coupons available for you at the moment" branch. */
export const CHECK_LOYALTY_BALANCE_EMPTY = {
  status_code: 200,
  response: { coupons: [], loyalty_points: 0 },
};

export const VALIDATE_COUPON_OK = {
  status_code: 200,
  response: { valid: true, coupon_code: "static6562" },
};

export const VALIDATE_COUPON_FAIL = {
  status_code: 400,
  response: { success: false, message: "Coupon not valid for this bill" },
};

/** authenticate_redemption is the step that SENDS the 4-digit OTP. */
export const AUTHENTICATE_REDEMPTION_OK = {
  status_code: 200,
  response: {
    authentication: true,
    points_value: 3000,
    message: "OTP sent to registered mobile",
  },
};

export const AUTHENTICATE_REDEMPTION_FAIL = {
  status_code: 400,
  response: {
    success: false,
    error_code: "LOYALTY_REDEMPTION_VALIDATION_FAILED",
    message: "Minimum purchase amount is not met for this reward.",
  },
};

/** redeem_coupon verifies the OTP and burns the points. */
export const REDEEM_COUPON_OK = {
  status_code: 200,
  response: {
    success: true,
    points_redeemed: 3000,
    remaining_points: 3000,
    coupon_code: "static6562",
    message: "Reward redeemed successfully",
  },
};

export const REDEEM_COUPON_FAIL = {
  status_code: 400,
  response: { success: false, message: "Invalid OTP. Please try again." },
};

/** Reelo-only op — mocked so an accidental call cannot hang the suite. */
export const REDEEM_POINTS_OK = {
  status_code: 200,
  response: { success: true, points_value: 0 },
};

/** GET https://xeno.in:2223/api/xeno/loyalty/undoRewardRedemption?… */
export const REVOKE_OK = { status: "success", pointsReturned: 3000 };

/** POST /api/cx/kiosk/getCustomerNameByNumber — sorted by `updated` desc. */
export const CUSTOMER_NAME_ROWS = [
  {
    firstname: "Rahul",
    lastname: "Sharma",
    phone: LOYALTY_PHONE,
    updated: "2026-06-10T09:00:00.000Z",
  },
];

/**
 * Kiosk-settings additions the specs spread into their get_kiosk_settings
 * mock. Existing suites (bag/offers/pack) omit these, so loyalty stays off for
 * them — zero regression by construction (contract trap 10).
 */
export const LOYALTY_SETTINGS = {
  enable_loyalty: true,
  crm_phone_mandatory: true,
  crm_name_mandatory: false,
  skip_crm_page: false,
};

/** Per-op override: a literal body, or a function of the posted request body. */
export type XenoEventResponse =
  | JsonBody
  | ((requestBody: unknown) => JsonBody);

export interface XenoMockOptions {
  /** Serve the empty-coupons balance instead of the 3-reward one. */
  emptyCoupons?: boolean;
  /** validate_coupon returns the 400-in-200 rejection (chain must stop here). */
  failValidate?: boolean;
  /** authenticate_redemption rejects (no OTP is ever "sent"). */
  failAuthenticate?: boolean;
  /** redeem_coupon rejects — the wrong-OTP path. */
  failRedeem?: boolean;
  /** Replace any op's body outright; wins over the fail* / emptyCoupons flags. */
  responses?: Partial<Record<XenoEventName, XenoEventResponse>>;
  /** Override the getLoyaltyPartner blob (e.g. a Reelo partner). */
  partner?: JsonBody;
  /** Override the getCustomerNameByNumber rows (`[]` = no prefill). */
  customerNameRows?: unknown[];
  /** Override the cross-origin revoke body. */
  revokeBody?: JsonBody;
}

/** Live counters — read them after the interaction under test. */
export interface XenoMockHandle {
  /** How many times the cross-origin revoke fetch fired. */
  revokeCount: number;
  /** Full revoke URLs, in order (assert apikey/phone/points/rewardId here). */
  revokeUrls: string[];
  /** Per-operation call counts. */
  events: Record<XenoEventName, number>;
  /** Every execute_event call, in order, with its parsed request body. */
  eventCalls: Array<{ eventName: string; body: unknown }>;
  /** getLoyaltyPartner / getCustomerNameByNumber hit counts. */
  partnerCount: number;
  customerNameCount: number;
}

const resolveBody = (
  override: XenoEventResponse | undefined,
  fallback: JsonBody,
  requestBody: unknown
): JsonBody => {
  if (typeof override === "function") return override(requestBody);
  return override ?? fallback;
};

const parseBody = (route: Route): unknown => {
  try {
    return route.request().postDataJSON();
  } catch {
    return undefined;
  }
};

/**
 * Register the whole Xeno surface. Call AFTER the spec's `mockKioskBackend`
 * (newest route wins). Returns the live counter handle.
 */
export async function mockXenoLoyalty(
  page: Page,
  opts: XenoMockOptions = {}
): Promise<XenoMockHandle> {
  const handle: XenoMockHandle = {
    revokeCount: 0,
    revokeUrls: [],
    events: {
      check_loyalty_balance: 0,
      validate_coupon: 0,
      authenticate_redemption: 0,
      redeem_coupon: 0,
      redeem_points: 0,
    },
    eventCalls: [],
    partnerCount: 0,
    customerNameCount: 0,
  };

  // Boot: resolves the deployment's partner. setLoyaltyPartner ALSO flips
  // state.loyalty.isLoyaltyOn — with enable_loyalty in settings that is what
  // makes getIsLoyaltyOn() true and routes /second → /phone.
  await page.route("**/api/cx/kiosk/getLoyaltyPartner", (route) => {
    handle.partnerCount += 1;
    return route.fulfill({ json: opts.partner ?? LOYALTY_PARTNER });
  });

  // TRAP 7: one url, five ops — branch on the event_name query param.
  await page.route(/\/api\/partners\/execute_event/, (route) => {
    const eventName =
      new URL(route.request().url()).searchParams.get("event_name") ?? "";
    const body = parseBody(route);
    handle.eventCalls.push({ eventName, body });
    if (eventName in handle.events) {
      handle.events[eventName as XenoEventName] += 1;
    }

    const override = opts.responses?.[eventName as XenoEventName];

    switch (eventName) {
      case "check_loyalty_balance":
        return route.fulfill({
          json: resolveBody(
            override,
            opts.emptyCoupons
              ? CHECK_LOYALTY_BALANCE_EMPTY
              : CHECK_LOYALTY_BALANCE_OK,
            body
          ),
        });
      case "validate_coupon":
        return route.fulfill({
          json: resolveBody(
            override,
            opts.failValidate ? VALIDATE_COUPON_FAIL : VALIDATE_COUPON_OK,
            body
          ),
        });
      case "authenticate_redemption":
        return route.fulfill({
          json: resolveBody(
            override,
            opts.failAuthenticate
              ? AUTHENTICATE_REDEMPTION_FAIL
              : AUTHENTICATE_REDEMPTION_OK,
            body
          ),
        });
      case "redeem_coupon":
        return route.fulfill({
          json: resolveBody(
            override,
            opts.failRedeem ? REDEEM_COUPON_FAIL : REDEEM_COUPON_OK,
            body
          ),
        });
      case "redeem_points":
        return route.fulfill({
          json: resolveBody(override, REDEEM_POINTS_OK, body),
        });
      default:
        // Unknown op: answer 200-shaped so nothing can hang.
        return route.fulfill({ json: { status_code: 200, response: {} } });
    }
  });

  // /customerName prefill (only fired when the redux name is empty).
  await page.route("**/api/cx/kiosk/getCustomerNameByNumber", (route) => {
    handle.customerNameCount += 1;
    return route.fulfill({ json: opts.customerNameRows ?? CUSTOMER_NAME_ROWS });
  });

  // TRAP 6: cross-origin revoke — outside the `**/api/**` catch-all. Without
  // this route the raw fetch in checkAndRevokeLoyaltyReward never settles.
  await page.route("https://xeno.in:2223/**", (route) => {
    handle.revokeCount += 1;
    handle.revokeUrls.push(route.request().url());
    return route.fulfill({ json: opts.revokeBody ?? REVOKE_OK });
  });

  return handle;
}
