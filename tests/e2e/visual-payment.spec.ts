import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mockCheckoutBackend, PLACE_ORDER_URL, type JsonBody } from "./fixtures/checkout";
import { clippedText } from "./fixtures/clippedText";
import {
  EDC_BUSY,
  PAYTM_DQR_ENTITY,
  PAYTM_EDC_ENTITY,
  PAYTM_ENDPOINTS,
  PAYTM_QR,
  mockPaytmBackend,
  paytmStatus,
  type PaytmMockHandle,
  type PaytmReply,
  type PaytmScript,
} from "./fixtures/paytm";

/**
 * Lane `fonts` — CAPTURE-ONLY screenshots of the PAYMENT screens (user
 * decision 2026-10-05: no pixel assertions until GT America is licensed and a
 * CI rendering image is fixed). Every walk attaches one PNG per screen
 * (`pay-NN-<screen>-<en|ar|ada>`) for review against the frames — /payment
 * 1:3364, /receipt 1:3377, PleaseWait 1:4456, /paymentPolling 1:3404, the
 * ErrorModal panels 1:3427 / 1:6288, Order Complete 1:5932 — and runs the
 * shared DOM-geometry probe after every shot (`clippedText`,
 * fixtures/clippedText.ts — soft, so every shot is still taken), plus the
 * targeted checks the fonts lane's payment fixes need (`expectCompressed`:
 * the frames' Cm Bd styles on the CTA cards, the TOTAL bar and Order
 * Complete's PROCEED line). Lane audit-fixes adds the plastic-sheen DOM
 * probe on PleaseWait and the EDC screen (UB3 — `sheenProblems`, copied from
 * visual-entry: the alpha WebP at 50 % normal, unturned, its alpha intact).
 *
 * Covered, in English, Arabic and ADA: /payment with 3, 2 and 1 tiles (the
 * COD tile says PAY AT RESTAURANT — the longest label) and its unavailable
 * branch, the Paytm buffer, the initiate's PleaseWait over /payment, the busy
 * and the local refusal initiate-failure modals over /payment, PLACING YOUR
 * ORDER, the push-failure panel and its uncertain variant; the EDC screen
 * (countdown, CANCEL PAYMENT, DOWN HERE), the cancel confirm, PleaseWait while
 * the void is out, both terminal-prompt lines, the staff panel and its
 * checking note, the post-payment /receipt (2026-10-13: the receipt question
 * follows the payment; no BACK) and Order Complete after a Paytm payment;
 * the DQR screen, its QR-unavailable fallback, its cancel confirm, the
 * settling PleaseWait and the expired panel. English only: the chunk-failure
 * panel (a reload mid-session) and the lazy Activity Center (operator UI on
 * the splash, which always runs in the primary language) with real-length
 * device / deployment names, the loyalty warning row, the passcode error and
 * the logout confirm.
 *
 * Mocks and walks are copied from paytm.spec / checkout.spec / visual-entry
 * (no spec exports them — the house precedent): the `**\/api/**` catch-all
 * FIRST, the cross-origin edges after it (print agent aborted, item photos
 * served locally so a walk never needs the network), every specific mock
 * after that, mockCheckoutBackend, then mockPaytmBackend LAST. The rupee
 * deployment (IN, ₹) is the Paytm market's and exercises the latin-ext face.
 * Time: page.clock is installed before the first goto and frozen before each
 * Paytm tile — the window's end is the initiate (paytm.spec TIME): screens
 * that would move on are held still by parking one request (`holdNext`) or by
 * stepping the clock only while no Paytm request is out.
 */

const readFixture = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)));
const readJson = (relative: string) =>
  JSON.parse(readFixture(relative).toString("utf-8"));

const slimMenu = readJson("./fixtures/slim-menu.json");
const en = readJson("../../src/i18n/locales/en/translation.json");
const ar = readJson("../../src/i18n/locales/ar/translation.json");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);
/** Every slim-menu item image. */
const ITEM_IMAGE_HOST = "https://itemsposistnet.s3.ap-south-1.amazonaws.com/**";

/** Real-length operator names: the Activity Center's device and deployment rows. */
const DEVICE_NAME = "TB-KIOSK-04 Ground Floor, Entrance B";
const DEPLOYMENT_NAME = "Taco Bell Phoenix Marketcity, Kurla West, Mumbai";
const LOGIN_OK = {
  licenseDetails: {
    login_code: "mock-device-token",
    expiry_date: "2099-01-01T00:00:00.000Z",
    device_name: DEVICE_NAME,
  },
  deploymentDetails: {
    _id: "dep1",
    brand_id: "brand1",
    tenant_id: "tenant1",
    cluster_id: "cluster1",
    deployment_name: DEPLOYMENT_NAME,
  },
};

/** £8 → 9.00 with VAT; a plain PDP commit. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
const TOTAL = "₹9.00";

/** SDK windows (paytm.spec): the DQR window and the settle window. */
const DQR_WINDOW_MS = 135_000;
const SETTLE_WINDOW_MS = 30_000;

/** The armed terminal (fixtures/paytm.ts DEFAULT_SCRIPT, not exported). */
const EDC_ARMED: PaytmReply = {
  json: { success: true, traceId: "t1", parkedOrder: {}, paytmResponse: {} },
};
/** The void reached the terminal, which wants the cancel approved there. */
const VOID_IN_PROGRESS: PaytmReply = { json: { status: "void_in_progress" } };
/** Past version 40-L's 2953 bytes: the encoder throws → PaytmQr's fallback. */
const UNENCODABLE_QR = `upi://pay?pa=e2e@paytm&tn=${"x".repeat(3_200)}`;

/** The lazy /paymentPolling screen as the DEV server serves it (paytm.spec). */
const PAYTM_CHUNK = "**/src/pages/PaytmPayment/paytmRuntime.ts*";

/** checkout.ts disableCodEntity("dine_in"): COD off under both key spellings. */
const DISABLE_COD = {
  _id: "disable_cod_kiosk_1",
  name: "disable_cod_kiosk",
  label: "Disable COD for Kiosk",
  tabs: [{ tabType: "dine_in", tabLabel: "dine_in", selected: true }],
};

const MODES = ["en", "ar", "ada"] as const;
type Mode = (typeof MODES)[number];
const copyFor = (mode: Mode) => (mode === "ar" ? ar : en);

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every <img> settled and every finite CSS keyframe animation (the modal /
 * PleaseWait entrances) at rest — they run in real time under a frozen
 * page.clock — then the fonts, the shot and the probe (visual-entry).
 */
async function capture(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Array.from(document.images).every((img) => img.complete) &&
          document
            .getAnimations()
            .every(
              (animation) =>
                !(animation instanceof CSSAnimation) ||
                animation.playState !== "running" ||
                !Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity)
            )
      )
    )
    .toBe(true);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
  expect.soft(await clippedText(page), `${name}: text the layout cuts off`).toEqual([]);
}

/**
 * UB3 (copied from visual-entry): every plastic sheen in `scope` is Figma's
 * plastic_2 as the stage-sized alpha WebP (crop and −90° baked in) at 50 %,
 * normal blend, unturned and as wide as the stage — and its transparency
 * survived decoding (the P1 JPEG was flattened onto white). The bitmap is
 * ~99.9 % translucent; a flattened copy is 0 %. Problems as text.
 */
function sheenProblems(scope: Locator): Promise<string[]> {
  return scope.locator('img[src*="plastic-overlay"]').evaluateAll(async (elements) => {
    if (elements.length === 0) return ["no plastic sheen"];
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    const k = stage ? stage.getBoundingClientRect().height / 1920 : 1;
    const problems: string[] = [];
    for (const img of elements as HTMLImageElement[]) {
      const file = (img.getAttribute("src") ?? "").split("?")[0].split("/").pop() ?? "";
      if (!/^plastic-overlay[^/]*\.webp$/.test(file)) problems.push(`${file}: not the alpha WebP`);
      await img.decode().catch(() => undefined);
      if (img.naturalWidth !== 1080 || img.naturalHeight !== 1920) {
        problems.push(`${file}: decoded ${img.naturalWidth}×${img.naturalHeight}`);
        continue;
      }
      const style = getComputedStyle(img);
      if (style.opacity !== "0.5") problems.push(`${file}: opacity ${style.opacity}`);
      if (style.mixBlendMode !== "normal") problems.push(`${file}: blend ${style.mixBlendMode}`);
      const turn = `${style.transform} ${style.getPropertyValue("rotate")}`;
      if (turn !== "none none") problems.push(`${file}: turned (${turn})`);
      const width = Math.round(img.getBoundingClientRect().width / k);
      if (width !== 1080) problems.push(`${file}: drawn ${width} px wide`);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return ["no 2d canvas"];
      context.drawImage(img, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let sampled = 0;
      let seeThrough = 0;
      for (let alpha = 3; alpha < pixels.length; alpha += 4 * 97) {
        sampled += 1;
        if (pixels[alpha] < 250) seeThrough += 1;
      }
      if (seeThrough / sampled < 0.9) {
        problems.push(`${file}: ${Math.round((100 * seeThrough) / sampled)} % see-through (flattened)`);
      }
    }
    return problems;
  });
}

/**
 * The fonts lane's payment fix: the frames' compressed text styles render in
 * .tb-compressed (Archivo 62 %/700) at the frame's size — CTA/Compressed
 * Large, Cm Bd 48/44, on the /payment and /receipt cards and the /payment
 * TOTAL bar (1:3364, 1:3377); Title/H4, Cm Bd 34/38, under the order number
 * (1:5932). The P1 files drew .tb-compressed at normal width, so these were
 * built in the expanded face (24–36 px) instead.
 */
async function expectCompressed(scope: Locator, size: number, lineHeight: number) {
  const styles = await scope.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return `${style.fontStretch} ${style.fontWeight} ${style.fontSize}/${style.lineHeight}`;
    })
  );
  expect.soft(styles.length, `${scope}: no element`).toBeGreaterThan(0);
  for (const style of styles) {
    expect.soft(style, `${scope}`).toBe(`62% 700 ${size}px/${lineHeight}px`);
  }
}

/** The /payment CTA card labels on show. */
const tileLabels = (page: Page) =>
  page.locator(
    ["payment-card", "payment-qr", "payment-counter"].map((id) => `[data-testid="${id}"] span`).join(", ")
  );

/**
 * The /payment labels in the frame's Cm Bd 48/44: the TOTAL bar's two halves always, the card labels in English.
 * An Arabic card label leads 64 (walk 2026-10-14: its 2–3 wrapped lines touched at 44) and its line boxes hold the
 * whole font box — at 44 the walk measured scrollHeight 92 > clientHeight 88.
 */
async function expectPaymentLabels(page: Page, mode: Mode) {
  await expectCompressed(page.locator('[data-testid="payment-total"] span'), 48, 44);
  await expectCompressed(tileLabels(page), 48, mode === "ar" ? 64 : 44);
  if (mode !== "ar") return;
  const boxes = await tileLabels(page).evaluateAll((labels) =>
    labels.map((label) => ({ text: label.textContent, scroll: label.scrollHeight, client: label.clientHeight }))
  );
  for (const box of boxes) expect.soft(box.scroll, `"${box.text}" overflows its lines`).toBeLessThanOrEqual(box.client);
}

/* ------------------------------------------------------------------ */
/* Boot (copied house helpers)                                         */
/* ------------------------------------------------------------------ */

interface BootOptions {
  mode: Mode;
  /** pay_at_counter off: the COD tile says PAY AT RESTAURANT. */
  restaurant?: boolean;
  /** Paytm device-setting rows. Default: both. */
  gateways?: JsonBody[];
  script?: PaytmScript;
  /** Extra get_kiosk_settings keys. */
  settings?: Record<string, unknown>;
}

async function mockKioskBackend(
  page: Page,
  { mode, restaurant = false, settings = {} }: BootOptions
) {
  const arabic = mode === "ar";
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all never sees them.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route(ITEM_IMAGE_HOST, (r) => r.fulfill({ body: PNG, contentType: "image/png" }));
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: arabic ? { name: "العربية", code: "ar", dir: "rtl" } : {},
      },
    })
  );
  await page.route("**/api/cx/getCxSkinData", (r) => r.fulfill({ json: { skin_id: "skin_1" } }));
  await page.route("**/api/cx/kiosk/get_theme", (r) =>
    r.fulfill({
      json: {
        theme_color: [
          { key: "button_text_border_icon", color_hex: "#501098" },
          { key: "button_background", color_hex: "#ffffff" },
        ],
        primary_color_shades: [],
      },
    })
  );
  await page.route("**/api/cx/get_kiosk_settings", (r) =>
    r.fulfill({
      json: {
        start_order_text_primary: "START ORDER",
        // A secondary language without its splash text fails the boot.
        ...(arabic ? { start_order_text_secondary: "ابدأ الطلب" } : {}),
        ideal_time: "180",
        // skipCRM: PAY on a dine-in tab goes straight to /payment.
        skip_crm_page: true,
        pay_at_counter: restaurant ? "pay_at_restaurant" : "pay_at_counter",
        accessibility_mode: true,
        ...settings,
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [{ _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" }],
    })
  );
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/cx/kiosk/get_data", (r) =>
    r.fulfill({
      json: {
        charges: [],
        deployment: { countryCode: "IN", currencySettings: { currency: "INR", text: "₹" } },
      },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

/** Register on the on-screen keyboard (digits behind the 123 layer) → the splash. */
async function registerToStart(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 20_000 });
}

/**
 * Mocks in the mandatory order → register → order type (Arabic chosen there)
 * → /menu (ADA toggled there) → one Cheese Burger → bag → PAY → /payment.
 */
async function bootToPayment(page: Page, opts: BootOptions): Promise<PaytmMockHandle> {
  await mockKioskBackend(page, opts);
  await mockCheckoutBackend(page, {
    extraDeviceSettings: opts.gateways ?? [PAYTM_EDC_ENTITY, PAYTM_DQR_ENTITY],
  });
  // LAST: its five routes must beat checkout's FORBIDDEN_PATH_RE.
  const paytm = await mockPaytmBackend(page, opts.script);

  await registerToStart(page);
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible({ timeout: 10_000 });
  if (opts.mode === "ar") {
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  }
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 20_000 });
  if (opts.mode === "ada") {
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  }

  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("added-continue").click();
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/cart$/);
  await expect(page.getByTestId("bag-pay")).toContainText("9.00", { timeout: 10_000 });
  await page.getByTestId("bag-pay").click();
  await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
  return paytm;
}

/** PAY AT COUNTER → the 3 s cancel window (flowing clock) → /receipt, before the push. */
async function chooseMethod(page: Page, tile: string) {
  await page.getByTestId(tile).click();
  await expect(page.getByTestId("payment-buffer")).toBeVisible();
  await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
}

/* ------------------------------------------------------------------ */
/* Time (paytm.spec)                                                   */
/* ------------------------------------------------------------------ */

const fakeNow = (page: Page) => page.evaluate(() => Date.now());

/** Pause the fake clock where it stands (+1 s); pauseAt refuses the past. */
async function freezeClock(page: Page) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.clock.pauseAt((await fakeNow(page)) + 1_000);
      return;
    } catch (error) {
      if (attempt === 3 || !String(error).includes("past")) throw error;
    }
  }
}

/** Small fake-time steps until `done()` — never while a Paytm request is out. */
async function stepClockUntil(
  page: Page,
  paytm: PaytmMockHandle,
  done: () => boolean | Promise<boolean>,
  { stepMs = 1_000, timeout = 60_000 } = {}
) {
  await expect
    .poll(
      async () => {
        if ((await paytm.inFlight()) === 0) await page.clock.runFor(stepMs);
        return done();
      },
      { timeout, intervals: [50] }
    )
    .toBe(true);
}

async function stepClockTo(page: Page, paytm: PaytmMockHandle, at: number) {
  await stepClockUntil(page, paytm, async () => (await fakeNow(page)) >= at, {
    stepMs: 4_000,
    timeout: 90_000,
  });
}

const visible = (page: Page, testId: string) => async () =>
  (await page.getByTestId(testId).count()) > 0;

/** Freeze, then tap a Paytm tile: it arms the type and opens the 3 s window (nothing sent). */
async function armPaytm(page: Page, tile: string) {
  await freezeClock(page);
  await page.getByTestId(tile).click();
  await expect(page.getByTestId("payment-buffer")).toBeVisible();
}

/** The window's 3 s end in the initiate, on /payment → /paymentPolling. */
async function initiateToPolling(page: Page) {
  await page.clock.runFor(3_000);
  await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });
}

/**
 * Parks the NEXT request to `url` until release(), then hands it on to the
 * older mocks (route.fallback) — registered last, so it sees it first.
 */
async function holdNext(page: Page, url: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let parked = false;
  await page.route(url, async (route) => {
    if (parked) return route.fallback();
    parked = true;
    await gate;
    return route.fallback();
  });
  return { release, parked: () => parked };
}

/* ------------------------------------------------------------------ */
/* The DEV-only store seam (paytm.spec E8b)                            */
/* ------------------------------------------------------------------ */

interface KioskStore {
  getState: () => {
    appSettings: { paymentSettings: JsonBody[]; deploymentInfoSettings: unknown };
    payment: { posBillTime: number | string };
  };
  dispatch: (action: { type: string; payload?: unknown }) => unknown;
}
interface StoreWindow {
  __kioskStore: KioskStore;
  __bootRows?: JsonBody[];
  __bootDeployment?: unknown;
}

/**
 * /payment's inputs as another deployment would serve them: the boot's Paytm
 * rows narrowed to `settingIds`, and COD off by the same deployment entity
 * mockCheckoutBackend serves for `codDisabled`.
 */
const servePayment = (page: Page, settingIds: string[], codOff = false) =>
  page.evaluate(
    ({ ids, off, disableCod }) => {
      const w = window as unknown as StoreWindow;
      const settings = w.__kioskStore.getState().appSettings;
      w.__bootRows ??= settings.paymentSettings;
      w.__bootDeployment ??= settings.deploymentInfoSettings;
      w.__kioskStore.dispatch({
        type: "appSettings/setPaymentSettings",
        payload: w.__bootRows.filter((row) => ids.includes(String(row.setting_id))),
      });
      w.__kioskStore.dispatch({
        type: "appSettings/setDeploymentInfo",
        payload: off ? [disableCod] : w.__bootDeployment,
      });
    },
    { ids: settingIds, off: codOff, disableCod: DISABLE_COD }
  );

const paymentBillTime = (page: Page) =>
  page.evaluate(() =>
    Number((window as unknown as StoreWindow).__kioskStore.getState().payment.posBillTime)
  );

/* ------------------------------------------------------------------ */
/* The walks                                                           */
/* ------------------------------------------------------------------ */

test.describe("lane fonts — payment captures", () => {
  // Before ANY page script: the app's timers must be fake from the start.
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  for (const mode of MODES) {
    const t = copyFor(mode);
    const tag = mode.toUpperCase();

    test(`${tag} CHECKOUT: /payment with 3, 2, 1 tiles and unavailable, the Paytm buffer, PleaseWait, the busy and refusal modals on /payment, the EDC screen, the cancel confirm, the YES prompt, the post-payment /receipt, Order Complete`, async ({
      page,
    }) => {
      test.slow();
      const paytm = await bootToPayment(page, {
        mode,
        restaurant: true,
        script: { edcInit: (call) => (call === 1 ? EDC_BUSY : EDC_ARMED) },
      });
      for (const id of ["payment-card", "payment-qr", "payment-counter"]) {
        await expect(page.getByTestId(id)).toBeVisible();
      }
      await expect(page.getByTestId("payment-counter")).toContainText(t.payment.payAtRestaurant);
      await capture(page, `pay-01-payment-3-tiles-${mode}`);
      await expectPaymentLabels(page, mode);
      // Figma 1:3371: the TOTAL bar is p-40 around the 44 px line.
      expect
        .soft(await page.getByTestId("payment-total").evaluate((bar) => (bar as HTMLElement).offsetHeight))
        .toBe(124);

      // The cancel window, held still.
      await freezeClock(page);
      await page.getByTestId("payment-qr").click();
      await expect(page.getByTestId("payment-buffer")).toContainText(t.paytm.redirecting);
      await capture(page, `pay-02-payment-buffer-${mode}`);
      await page.getByTestId("payment-buffer-cancel").click();
      await expect(page.getByTestId("payment-buffer")).toHaveCount(0);
      await page.clock.resume();

      await servePayment(page, ["PaytmEdc"]);
      await expect(page.getByTestId("payment-qr")).toHaveCount(0);
      await expect(page.getByTestId("payment-card")).toBeVisible();
      await capture(page, `pay-03-payment-2-tiles-${mode}`);
      await expectPaymentLabels(page, mode);
      await servePayment(page, []);
      await expect(page.getByTestId("payment-card")).toHaveCount(0);
      await expect(page.getByTestId("payment-counter")).toBeVisible();
      await capture(page, `pay-04-payment-1-tile-${mode}`);
      await expectPaymentLabels(page, mode);
      await servePayment(page, [], true);
      await expect(page.getByTestId("payment-unavailable")).toContainText(
        t.payment.unavailableBody
      );
      await capture(page, `pay-05-payment-unavailable-${mode}`);
      await servePayment(page, ["PaytmEdc", "PaytmDynamicQr"]);
      await expect(page.getByTestId("payment-qr")).toBeVisible();

      // The window's end is the initiate (2026-10-13), parked: PleaseWait
      // covers /payment — at once, it replaces the window.
      await armPaytm(page, "payment-card");
      const initiate = await holdNext(page, PAYTM_ENDPOINTS.edcInit);
      await page.clock.runFor(3_000);
      await expect.poll(initiate.parked).toBe(true);
      await expect(page.getByTestId("paytm-preparing")).toContainText(t.paytm.wait.preparing);
      await expect(page).toHaveURL(/\/payment$/);
      await capture(page, `pay-06-payment-preparing-${mode}`);
      expect
        .soft(await sheenProblems(page.getByTestId("paytm-preparing")), `pay-06-${mode}: PleaseWait's sheen (UB3)`)
        .toEqual([]);
      initiate.release();
      const failed = page.getByTestId("paytm-initiate-failed");
      await expect(failed).toContainText(t.paytm.failed.busy, { timeout: 15_000 });
      await expect(page.getByTestId("paytm-initiate-retry")).toBeVisible();
      await capture(page, `pay-07-initiate-busy-${mode}`);

      // TRY AGAIN with no usable row left: the local refusal (E8b).
      await servePayment(page, []);
      await page.getByTestId("paytm-initiate-retry").click();
      await expect(page.getByTestId("paytm-initiate-other")).toBeVisible();
      await expect(failed).toContainText(t.paytm.failed.start);
      await capture(page, `pay-08-initiate-refused-${mode}`);
      await servePayment(page, ["PaytmEdc", "PaytmDynamicQr"]);
      // PAY ANOTHER WAY closes the modal in place: already on /payment.
      await page.getByTestId("paytm-initiate-other").click();
      await expect(failed).toHaveCount(0);
      await expect(page.getByTestId("payment-card")).toBeVisible({ timeout: 10_000 });

      await armPaytm(page, "payment-card");
      await initiateToPolling(page);
      await expect(page.getByTestId("paytm-total")).toContainText(TOTAL);
      await expect(page.getByTestId("paytm-countdown")).toBeVisible();
      await capture(page, `pay-09-edc-${mode}`);
      expect
        .soft(await sheenProblems(page.getByTestId("paytm-screen")), `pay-09-${mode}: the EDC screen's sheen (UB3)`)
        .toEqual([]);

      await stepClockUntil(page, paytm, () => paytm.counts.edcStatus === 1);
      await page.getByTestId("paytm-cancel").click();
      await expect(page.getByTestId("paytm-cancel-confirm")).toContainText(
        t.paytm.cancelConfirm.message
      );
      await capture(page, `pay-10-cancel-confirm-${mode}`);
      await page.getByTestId("paytm-cancel-yes").click();
      // The fresh read and the delivered void are effect-driven: no time moves.
      await expect(page.getByTestId("paytm-terminal-prompt")).toContainText(
        t.paytm.edc.pressYesToCancel,
        { timeout: 15_000 }
      );
      await capture(page, `pay-11-terminal-prompt-${mode}`);

      // The guest had paid after all: the next read lands on the receipt
      // question, AFTER the payment (no BACK — the order is placed and paid).
      paytm.script.edcStatus = () => paytmStatus("paid");
      await stepClockUntil(page, paytm, visible(page, "receipt-screen"));
      await expect(page.getByTestId("receipt-back")).toHaveCount(0);
      // Print only (2026-10-12): the question and its YES / NO, no EMAIL.
      await expect(page.getByTestId("receipt-none")).toContainText(t.receipt.no);
      await expect(page.getByTestId("receipt-email")).toHaveCount(0);
      // The longer question must stay clear of the YES / NO row in every mode.
      const [question, answers] = await Promise.all([
        page.getByRole("heading", { level: 1 }).boundingBox(),
        page.getByTestId("receipt-print").boundingBox(),
      ]);
      if (!question || !answers) throw new Error("the receipt question or YES has no box");
      expect(question.y + question.height, "the question ends above YES / NO").toBeLessThan(answers.y);
      await capture(page, `pay-12-receipt-after-payment-${mode}`);
      await expectCompressed(
        page.locator('[data-testid="receipt-print"] span, [data-testid="receipt-none"] span'),
        48,
        44
      );
      await page.getByTestId("receipt-none").click();
      await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 15_000 });
      const posBillNo = paytm.bodies.edcInit.at(-1)?.posBillNo ?? "";
      await expect(page.getByTestId("order-number")).toHaveText(`#${posBillNo.slice(-5)}`);
      await capture(page, `pay-13-order-complete-${mode}`);
      await expectCompressed(
        page.getByTestId("order-success").getByText(t.success.proceedToCounter),
        34,
        38
      );
    });

    test(`${tag} STAFF PANEL: PleaseWait while the void is out, the approve-on-machine prompt, the unknown panel and its checking note`, async ({
      page,
    }) => {
      test.slow();
      const paytm = await bootToPayment(page, {
        mode,
        script: { edcCancel: () => VOID_IN_PROGRESS },
      });
      await armPaytm(page, "payment-card");
      await initiateToPolling(page);
      await stepClockUntil(page, paytm, () => paytm.counts.edcStatus === 1);

      const voidCall = await holdNext(page, PAYTM_ENDPOINTS.edcCancel);
      await page.getByTestId("paytm-cancel").click();
      await page.getByTestId("paytm-cancel-yes").click();
      await expect.poll(voidCall.parked).toBe(true);
      await expect(page.getByTestId("paytm-confirming")).toContainText(
        t.paytm.wait.cancelling
      );
      await capture(page, `pay-14-cancelling-${mode}`);
      voidCall.release();
      await expect(page.getByTestId("paytm-terminal-prompt")).toContainText(
        t.paytm.edc.approveOnMachine,
        { timeout: 15_000 }
      );
      await capture(page, `pay-15-terminal-approve-${mode}`);

      await stepClockUntil(page, paytm, visible(page, "paytm-unknown"), { stepMs: 2_000 });
      await expect(page.getByTestId("paytm-unknown")).toContainText(
        paytm.bodies.edcInit[0].posBillNo.slice(-5)
      );
      await capture(page, `pay-16-unknown-${mode}`);

      const check = await holdNext(page, PAYTM_ENDPOINTS.edcStatus);
      await page.getByTestId("paytm-unknown-check").click();
      await expect.poll(check.parked).toBe(true);
      await expect(page.getByTestId("paytm-unknown-note")).toContainText(
        t.paytm.unknown.checking
      );
      await capture(page, `pay-17-unknown-checking-${mode}`);
      paytm.script.edcStatus = () => paytmStatus("paid");
      check.release();
      await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    });

    test(`${tag} DQR: the QR-unavailable fallback, the QR cancel confirm, the QR screen, settling and the expired panel`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const paytm = await bootToPayment(page, {
        mode,
        script: {
          dqrInit: (call) => ({ json: { qrCode: call === 1 ? UNENCODABLE_QR : PAYTM_QR } }),
        },
      });
      await armPaytm(page, "payment-qr");
      await initiateToPolling(page);
      await expect(page.getByTestId("paytm-qr-unavailable")).toContainText(
        t.paytm.qr.unavailable
      );
      await capture(page, `pay-18-qr-unavailable-${mode}`);

      await stepClockUntil(page, paytm, () => paytm.counts.dqrStatus === 1);
      await page.getByTestId("paytm-cancel").click();
      await expect(page.getByTestId("paytm-cancel-confirm")).toContainText(
        t.paytm.cancelConfirm.messageQr
      );
      await capture(page, `pay-19-cancel-confirm-qr-${mode}`);
      await page.getByTestId("paytm-cancel-yes").click();
      await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
      await page.clock.resume();

      await armPaytm(page, "payment-qr");
      await initiateToPolling(page);
      await expect(page.getByTestId("paytm-qr").locator("svg")).toHaveCount(1);
      await capture(page, `pay-20-dqr-${mode}`);

      const deadline = (await paymentBillTime(page)) + DQR_WINDOW_MS;
      await stepClockTo(page, paytm, deadline + SETTLE_WINDOW_MS - 10_000);
      await expect(page.getByTestId("paytm-qr")).toHaveCount(0);
      await expect(page.getByTestId("paytm-confirming")).toContainText(t.paytm.wait.confirming);
      await capture(page, `pay-21-dqr-settling-${mode}`);
      await stepClockUntil(page, paytm, visible(page, "paytm-failed"));
      await expect(page.getByTestId("paytm-failed")).toContainText(t.paytm.failed.expired);
      await capture(page, `pay-22-failed-expired-${mode}`);
    });

    test(`${tag} ORDER ERROR: /receipt placing the order, its push-failure panel and the uncertain variant`, async ({
      page,
    }) => {
      test.slow();
      await bootToPayment(page, { mode });
      // Newest wins over mockCheckoutBackend's placeOrder: the first push is
      // parked for its shot; four 500s exhaust the ladder; the customer's
      // Retry then loses its 2xx body (outcome unknown → uncertain copy).
      let pushes = 0;
      let releasePush = () => {};
      const parked = new Promise<void>((resolve) => {
        releasePush = resolve;
      });
      await page.route(PLACE_ORDER_URL, async (route) => {
        const push = (pushes += 1);
        if (push === 1) await parked;
        return push <= 4
          ? route.fulfill({ status: 500, json: { status: false, message: "Order not placed" } })
          : route.fulfill({ status: 200, contentType: "application/json", body: "not-json" });
      });
      await chooseMethod(page, "payment-counter");
      await page.getByTestId("receipt-none").click();
      await expect(page.getByTestId("payment-buffer")).toContainText(t.payment.placingOrder);
      await capture(page, `pay-23-receipt-placing-${mode}`);
      releasePush();

      const panel = page.getByTestId("order-error");
      await expect(panel).toContainText(t.orderError.message, { timeout: 30_000 });
      await capture(page, `pay-24-order-error-${mode}`);
      await page.getByTestId("order-error-retry").click();
      await expect(panel).toContainText(t.orderError.uncertainMessage, { timeout: 15_000 });
      await capture(page, `pay-25-order-error-uncertain-${mode}`);
    });
  }

  test("EN CHUNK FAILURE: a resumed EDC session whose screen chunk never arrives — the staff panel with FINISH only", async ({
    page,
  }) => {
    test.slow();
    // The flowing clock on purpose: redux-persist flushes on timers (paytm.spec E19b).
    const paytm = await bootToPayment(page, { mode: "en" });
    // The window's 3 s on the flowing clock: its end is the initiate.
    await page.getByTestId("payment-card").click();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => paytm.counts.edcStatus, { timeout: 15_000 }).toBeGreaterThan(0);

    await page.route(PAYTM_CHUNK, (route) => route.abort());
    await page.reload();
    await expect(page.getByTestId("paytm-unavailable")).toContainText(
      paytm.bodies.edcInit[0].posBillNo.slice(-5),
      { timeout: 20_000 }
    );
    await freezeClock(page);
    await capture(page, "pay-26-chunk-failure-en");
  });

  test("EN ACTIVITY CENTER (lazy): real-length device and deployment names, the loyalty warning row, the passcode error, the logout confirm", async ({
    page,
  }) => {
    test.slow();
    // Loyalty on, its partner lookup failing: the warning row (P9b).
    await mockKioskBackend(page, { mode: "en", settings: { enable_loyalty: true } });
    await page.route("**/api/cx/kiosk/getLoyaltyPartner", (r) =>
      r.fulfill({ status: 500, json: {} })
    );
    await registerToStart(page);
    // The hidden operator gesture (useLongPress): a 3 s hold, in fake time.
    const box = await page.getByTestId("activity-hotspot").boundingBox();
    if (!box) throw new Error("activity-hotspot has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.clock.runFor(3_000);
    await page.mouse.up();

    const modal = page.getByTestId("activity-modal");
    await expect(modal).toContainText(en.activity.title);
    await expect(modal).toContainText(DEPLOYMENT_NAME);
    await expect(modal).toContainText(DEVICE_NAME);
    await expect(modal).toContainText(en.activity.loyaltyUnavailable);
    await capture(page, "pay-27-activity-en");

    // Mandatory fullscreen starts on: switching it off asks for the passcode,
    // typed on the on-screen keyboard docked under the lifted card (U2).
    await page.getByTestId("activity-fullscreen-toggle").click();
    const keyboard = page.getByTestId("kiosk-keyboard");
    await keyboard.getByRole("button", { name: en.keyboard.layerToggle }).click();
    for (let i = 0; i < 4; i++) {
      await keyboard.getByRole("button", { name: "0", exact: true }).click();
    }
    await expect(page.getByTestId("activity-passcode-input")).toHaveValue("0000");
    await page.getByTestId("activity-passcode-submit").click();
    await expect(page.getByTestId("activity-passcode-error")).toContainText(
      en.activity.invalidPasscode
    );
    await expect(keyboard).toBeVisible();
    await capture(page, "pay-28-activity-passcode-en");
    // The card's last row stays clear of the keyboard (the card centres on 700).
    const lastRow = await page.getByTestId("activity-close").boundingBox();
    const keys = await keyboard.boundingBox();
    expect.soft((lastRow?.y ?? 0) + (lastRow?.height ?? 0), "card above the keyboard").toBeLessThan(keys?.y ?? 0);

    await page.getByTestId("activity-logout").click();
    await expect(page.getByTestId("activity-logout-confirm")).toContainText(
      en.activity.logoutConfirmBody
    );
    await capture(page, "pay-29-activity-logout-en");
  });
});
