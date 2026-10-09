import { test, expect, type Page } from "./fixtures/kiosk";
import { mockKioskBackend as mockBackend, fixtureJson, locale, GREEK_SALAD } from "./fixtures/backend";
import { registerToStart } from "./pages/boot";
import { mockCheckoutBackend, type DeviceSettingEntity } from "./fixtures/checkout";

/**
 * Lane figma-polish S3 — /second sells only what this device may sell, and
 * the menu's charges follow the order type the guest PICKED.
 *
 * - DEACTIVATED: the `deactivated_pipelines` general setting (getKisokDeviceData,
 *   `group: "general"`) hides those order types on /second (fork parity); the
 *   rest keep their `order`. With every one hidden, one translated line
 *   (`second.noPipelines`) stands in for the cards and CANCEL still exits.
 * - MONEY: getMenu's own `charges` apply to every kiosk order type except
 *   "table". /second dispatches setTabType and fetches the menu in the same
 *   tick, so the fetch used to read the PREVIOUS session's tab type: a guest
 *   after a table session lost the menu charges, and a table guest after a
 *   take-away session paid them. fetchMenu now reads the picked pipeline's own
 *   tab_type. The bag shows charges inside its Total (no line of their own):
 *   Greek Salad £17 → round(17 × 1.15) = £20 without the £2 packing charge,
 *   £22 with it (bag.spec header: exclusive VAT@15%).
 *
 * Mocks: the harness house order, NEWEST route wins: the shared mock first
 * (fixtures/backend.ts — its origin-scoped `/api/` catch-all, then every boot
 * endpoint), then the checkout fixture, which serves getKisokDeviceData (and
 * getPipelines only when given a `tabType` — never here); the spec's own
 * pipelines are registered last, over the shared mock's one row. The
 * local DINE_IN / TABLE / TAKE_AWAY rows are this spec's own pipelines.
 */

const en = locale("en");

const DINE_IN = { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" };
const TABLE = { _id: "p1", tab_id: "t1", tab_type: "table", primary_name: "Table Service" };
const TAKE_AWAY = { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take Away" };

/** The menu's own charge (getMenu `charges`): a fixed, untaxed £2 for kiosk orders. */
const MENU_CHARGE = {
  _id: "mc-pack",
  name: "Packing",
  partners: ["Kiosk"],
  value: { isActive: true, type: "Fixed", amount: 2, chargeNature: "FIXED" },
};

/** The device's deactivated order types (a getKisokDeviceData general row). */
const deactivatedPipelines = (ids: string[]): DeviceSettingEntity => ({
  _id: "general_deactivated_pipelines",
  deployment_id: "dep1",
  license_key: "mock-device-token",
  tenant_id: "tenant1",
  setting_label: "deactivated_pipelines",
  setting_id: "deactivated_pipelines",
  group: "general",
  channel: "Kiosk",
  value: { value: ids },
});

interface MockOptions {
  pipelines: object[];
  /** Order types deactivated for this device. */
  deactivated?: string[];
  /** getMenu carries MENU_CHARGE. */
  menuCharge?: boolean;
}

async function mockKioskBackend(page: Page, opts: MockOptions) {
  await mockBackend(page, {
    menu: opts.menuCharge ? { ...fixtureJson("slim-menu.json"), charges: [MENU_CHARGE] } : undefined,
  });
  await mockCheckoutBackend(page, {
    extraDeviceSettings: opts.deactivated ? [deactivatedPipelines(opts.deactivated)] : [],
  });
  // Over the shared mock's one row (newest wins); the checkout fixture leaves getPipelines alone.
  await page.route("**/api/cx/kiosk/getPipelines", (r) => r.fulfill({ json: opts.pipelines }));
}

/** Splash → /second → the pipeline → /menu. */
async function orderAs(page: Page, pipelineId: string) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId(`pipeline-${pipelineId}`).click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/** One Greek Salad, then VIEW MY BAG (through the session's /forYou upsell). */
async function bagOneSalad(page: Page) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page.getByTestId("bag-subtotal")).toContainText("£17.00");
}

/** Bag → CANCEL ORDER → the splash: the next guest. */
async function endSession(page: Page) {
  await page.getByTestId("bag-close").click();
  await page.getByTestId("footer-cancel").click();
  await page.getByTestId("cancel-order-confirm").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

interface KioskState {
  cart: { menuCharges?: { id?: string }[] };
  pipeline: { pipelines: { _id: string }[] };
}
const kioskState = (page: Page) =>
  page.evaluate(() => {
    const state = (
      window as unknown as { __kioskStore: { getState: () => KioskState } }
    ).__kioskStore.getState();
    return {
      menuCharges: (state.cart.menuCharges ?? []).map((charge) => charge.id),
      pipelines: state.pipeline.pipelines.map((pipeline) => pipeline._id),
    };
  });

test.describe("figma-polish S3 — /second's order types and the picked pipeline's charges", () => {
  test("DEACTIVATED: an order type deactivated for this device never shows — the one left is centred and still sells", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { pipelines: [DINE_IN, TAKE_AWAY], deactivated: ["p2"] });
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toContainText(en.second.title);

    // Both arrived; the device hides one.
    expect((await kioskState(page)).pipelines).toEqual(["p1", "p2"]);
    await expect(page.locator('[data-testid^="pipeline-"]')).toHaveCount(1);
    await expect(page.getByTestId("pipeline-p1")).toContainText("Dine In");
    await expect(page.getByTestId("pipeline-p2")).toHaveCount(0);
    await expect(page.getByTestId("second-no-pipelines")).toHaveCount(0);
    // The card arrives with /second's entrance (motion lane): even under
    // reduced motion it rests a frame or two after mount, so poll its box.
    await expect
      .poll(
        async () => {
          const box = await page.getByTestId("pipeline-p1").boundingBox();
          return box ? Math.abs(box.x + box.width / 2 - 540) : Number.POSITIVE_INFINITY;
        },
        { message: "the card has a box, centred on the stage" }
      )
      .toBeLessThanOrEqual(1);

    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  });

  test("ALL DEACTIVATED: one translated line stands in for the cards, and CANCEL takes the guest back to the splash", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { pipelines: [DINE_IN, TAKE_AWAY], deactivated: ["p1", "p2"] });
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toContainText(en.second.title);

    await expect(page.getByTestId("second-no-pipelines")).toHaveText(en.second.noPipelines);
    await expect(page.locator('[data-testid^="pipeline-"]')).toHaveCount(0);
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/start$/);
  });

  test("ORDER: the cards follow each order type's configured `order` (missing = 0), never the server's list order — and a deactivated one stays out whatever its order", async ({
    page,
  }) => {
    test.slow();
    const driveThru = { _id: "p3", tab_id: "t3", tab_type: "drive_thru", primary_name: "Drive Thru" };
    const delivery = { _id: "p4", tab_id: "t4", tab_type: "delivery", primary_name: "Delivery" };
    await mockKioskBackend(page, {
      // Server order p3, p2, p4, p1; configured order p1 (none) < p4 < p2 < p3.
      pipelines: [
        { ...driveThru, order: 3 },
        { ...TAKE_AWAY, order: 2 },
        { ...delivery, order: 1 },
        DINE_IN,
      ],
      deactivated: ["p4"],
    });
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toContainText(en.second.title);

    expect((await kioskState(page)).pipelines).toEqual(["p3", "p2", "p4", "p1"]);
    await expect(page.locator('[data-testid^="pipeline-"]')).toHaveCount(3);
    expect(
      await page
        .locator('[data-testid^="pipeline-"]')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-testid")))
    ).toEqual(["pipeline-p1", "pipeline-p2", "pipeline-p3"]);
  });

  test("MONEY, TABLE → TAKE AWAY: a table guest pays no menu charges; the take-away guest after them DOES (never the previous session's tab type)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { pipelines: [TABLE, TAKE_AWAY], menuCharge: true });
    await registerToStart(page);

    await orderAs(page, "p1");
    await bagOneSalad(page);
    await expect(page.getByTestId("bag-total")).toContainText("£20.00");
    expect((await kioskState(page)).menuCharges).toEqual([]);
    await endSession(page);

    await orderAs(page, "p2");
    await bagOneSalad(page);
    await expect(page.getByTestId("bag-total")).toContainText("£22.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£22.00");
    // U4: the packing charge rides the Taxes & charges line with the VAT
    // (2.55 + 2.00); Round off is what the whole-pound Total added.
    await expect(page.getByTestId("bag-taxes-charges")).toHaveText("+£4.55");
    await expect(page.getByTestId("bag-round-off")).toHaveText("+£0.45");
    expect((await kioskState(page)).menuCharges).toEqual([MENU_CHARGE._id]);
  });

  test("MONEY, SLOW CHARGES (audit-fixes C1b): the deployment's charges call answers after the menu loaded — its late composition keeps the menu's packing charge (read back from the store)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { pipelines: [TABLE, TAKE_AWAY], menuCharge: true });
    await registerToStart(page);
    // /second's get_data is not awaited (it races the menu): hold it until
    // the menu has pushed its own charges (newest route wins).
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/cx/kiosk/get_data", async (route) => {
      await held;
      return route.fulfill({
        json: {
          charges: [],
          deployment: { countryCode: "GB", currencySettings: { currency: "GBP", text: "£" } },
        },
      });
    });
    await orderAs(page, "p2");
    expect((await kioskState(page)).menuCharges).toEqual([MENU_CHARGE._id]);
    const answered = page.waitForResponse("**/api/cx/kiosk/get_data");
    release();
    await answered;

    await bagOneSalad(page);
    // round(17 × 1.15 + 2) — the packing charge survived the late answer.
    await expect(page.getByTestId("bag-total")).toContainText("£22.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£22.00");
  });

  test("MONEY, TAKE AWAY → TABLE: the take-away guest pays the menu charge; the table guest after them does NOT", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { pipelines: [TABLE, TAKE_AWAY], menuCharge: true });
    await registerToStart(page);

    await orderAs(page, "p2");
    await bagOneSalad(page);
    await expect(page.getByTestId("bag-total")).toContainText("£22.00");
    expect((await kioskState(page)).menuCharges).toEqual([MENU_CHARGE._id]);
    await endSession(page);

    await orderAs(page, "p1");
    await bagOneSalad(page);
    await expect(page.getByTestId("bag-total")).toContainText("£20.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£20.00");
    expect((await kioskState(page)).menuCharges).toEqual([]);
  });
});
