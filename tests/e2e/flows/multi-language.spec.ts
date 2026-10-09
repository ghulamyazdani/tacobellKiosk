import { test, expect, type Page } from "../fixtures/kiosk";
import { mockKioskBackend, locale, SKIP_CRM, DINE_IN, CHEESE_BURGER } from "../fixtures/backend";
import { mockCheckoutBackend, expectNothingDangerousWasContacted } from "../fixtures/checkout";
import { englishCopy, untranslatedCopy, arabicNotIsolated } from "../fixtures/a11y";
import { settle, shot } from "../fixtures/capture";
import { registerToStart, startToSecond, chooseLanguage, pickPipelineToMenu } from "../pages/boot";
import { payAtCounter } from "../pages/checkout";

/**
 * Rulebook flow 5 — "verify ALL visible text updates" (P9f §4.4). One Arabic order, and on every
 * screen: <html lang="ar">, the screen's own Arabic copy, NO visible English UI string, and every
 * Arabic run isolated (FSI…PDI) or inside an rtl element. menu-arabic.spec owns the menu-name
 * aliases, the English push and MIAM; this sweeps the screens it never asserts (/payment, /receipt,
 * Order Complete). The pipeline's Arabic name matters: "Dine In" is also an English UI string.
 */
test.use({ strictConsole: true });

const en = locale("en");
const ar = locale("ar");
const ENGLISH = englishCopy();
const AR_ROW = { ...DINE_IN, secondary_name: "تناول في المطعم" };

/**
 * Attribute-only app fixes this sweep found and handed to an app lane (P9f §4.5 policy): each entry
 * names its target (the arabicNotIsolated prefix) and the handoff. Never a wholesale skip — an entry
 * the walk no longer meets (the fix landed) fails the test until it is removed, and an unlisted
 * target still fails.
 */
const PENDING_APP_FIX: { target: string; why: string }[] = [
  {
    target: "footer-language",
    why: 'FooterBar renders the selected language\'s own name (العربية) raw in an LTR span: needs dir="auto" (FooterBar.tsx:79-82) — P9f F handoff to the app lane',
  },
];
/** The PENDING_APP_FIX targets this test's walk actually met. */
const pendingMet = new Set<string>();

/** The screen (testid) shows its Arabic copy and nothing else, then a capture. */
async function expectArabicScreen(page: Page, label: string, screen: string, arabic: string) {
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByTestId(screen)).toContainText(arabic);
  await settle(page);
  expect(await untranslatedCopy(page, ENGLISH), `${label}: English UI copy on screen`).toEqual([]);
  const bare = (await arabicNotIsolated(page)).filter((finding) => {
    const fix = PENDING_APP_FIX.find(({ target }) => finding.startsWith(`${target}:`));
    if (fix) pendingMet.add(fix.target);
    return !fix;
  });
  expect(bare, `${label}: Arabic outside an isolate`).toEqual([]);
  await shot(page, label);
}

test.describe("Flow 5 — multi-language", () => {
  test.beforeEach(() => pendingMet.clear());

  test("EVERY SCREEN IN ARABIC: order type → menu → PDP → For You → bag → payment → receipt → Order Complete, then the next guest is English", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install();
    await mockKioskBackend(page, { arabic: true, settings: SKIP_CRM, pipelines: [AR_ROW] });
    const checkout = await mockCheckoutBackend(page);
    // The checkout fixture re-routes getPipelines (one English row): the Arabic name goes back on top.
    await page.route("**/api/cx/kiosk/getPipelines", (r) => r.fulfill({ json: [AR_ROW] }));

    await registerToStart(page);
    await startToSecond(page);
    await chooseLanguage(page, "ar");
    await expectArabicScreen(page, "ar-01-second", "second-screen", ar.second.title);

    await pickPipelineToMenu(page);
    await expectArabicScreen(page, "ar-02-menu", "cta-view-bag", ar.menu.viewMyBag);

    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expectArabicScreen(page, "ar-03-pdp", "pdp-add-to-bag", ar.pdp.addToBag);
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await expect(page.getByTestId("product-added-modal")).toHaveCount(0);

    // The session's first VIEW MY BAG meets the upsell: a gate change fails here, by name.
    await page.getByTestId("cta-view-bag").click();
    await expect(page).toHaveURL(/\/forYou$/);
    await expectArabicScreen(page, "ar-04-for-you", "foryou-screen", ar.upsell.notToday);
    await page.getByTestId("foryou-primary").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    // Prices stay LTR isolates inside the Arabic copy.
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expectArabicScreen(page, "ar-05-bag", "bag-sheet", ar.bag.title);

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible();
    await expectArabicScreen(page, "ar-06-payment", "payment-screen", ar.payment.title);

    await payAtCounter(page);
    await expectArabicScreen(page, "ar-07-receipt", "receipt-screen", ar.receipt.title);

    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    await expectArabicScreen(page, "ar-08-complete", "order-success", ar.success.thankYou);
    expect(checkout.placeOrderCount).toBe(1);
    expectNothingDangerousWasContacted(checkout);

    // Unattended: Order Complete's 20 s countdown ends the session; the next guest starts English.
    await page.clock.runFor(20_000);
    await expect(page.getByTestId("start-screen")).toBeVisible();
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await startToSecond(page);
    await expect(page.getByTestId("second-screen")).toContainText(en.second.title);

    expect(
      PENDING_APP_FIX.map(({ target }) => target).filter((target) => !pendingMet.has(target)),
      "PENDING_APP_FIX entries no screen shows any more (the fix landed): remove them",
    ).toEqual([]);
  });
});
