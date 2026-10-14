import { test, expect, dexieRows } from "../fixtures/kiosk";
import { mockKioskBackend, CHEESE_BURGER, GREEK_SALAD } from "../fixtures/backend";
import { bootRegisteredToMenu } from "../pages/boot";
import { addOneTap, addViaPdp, openBag, bagRows } from "../pages/order";

/**
 * Rulebook flow 2 — cart management (P9f §4.2). bag.spec owns the single-row stepper and the
 * empty-bag removal; this walk removes ONE row of a two-row bag: the bag stays open on /cart, the
 * survivor's money is right on every surface, and the Dexie mirror (what a reload restores) agrees.
 * Money: slim-menu prices exclude 15 % VAT; Total = round(SubTotal × 1.15).
 */
test.use({ strictConsole: true });

test.describe("Flow 2 — cart management", () => {
  test("TWO ROWS: the burger steps to ×3 and back without a prompt, then its removal confirms and leaves the salad in an open bag", async ({
    page,
  }) => {
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    await addOneTap(page, GREEK_SALAD, "(1)");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £20$/);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £29$/);

    await openBag(page);
    const sheet = page.getByTestId("bag-sheet");
    await expect(sheet).toContainText("My Bag (2)");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-total")).toContainText("£29.00"); // 28.75

    const burgerRow = bagRows(page).filter({ hasText: "Cheese Burger" });
    await expect(burgerRow).toHaveCount(1);
    const id = ((await burgerRow.getAttribute("data-testid")) ?? "").replace("bag-row-", "");
    expect(id).not.toBe("");

    // The line is total_price × qty (BagItemRow): three burgers read £24.00.
    for (let tap = 0; tap < 2; tap++) await page.getByTestId(`bag-inc-${id}`).click();
    await expect(burgerRow).toContainText("£24.00");
    await expect(sheet).toContainText("My Bag (4)");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£41.00");
    await expect(page.getByTestId("bag-total")).toContainText("£47.00"); // 47.15
    await expect(page.getByTestId("bag-pay")).toContainText("£47.00");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £47$/);

    // Down to one: a decrement above 1 never asks.
    for (let tap = 0; tap < 2; tap++) {
      await page.getByTestId(`bag-dec-${id}`).click();
      await expect(page.getByTestId("remove-item-modal")).toHaveCount(0);
    }
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");

    // At 1 the decrement is a removal: it confirms first.
    await page.getByTestId(`bag-dec-${id}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await page.getByTestId("remove-item-confirm").click();
    await expect(page.getByTestId("remove-item-modal")).toHaveCount(0);

    // The bag survives its other row: still open on /cart, the salad's money everywhere.
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page)).toContainText("Greek Salad");
    await expect(sheet).toContainText("My Bag (1)");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£17.00");
    await expect(page.getByTestId("bag-total")).toContainText("£20.00"); // 19.55
    await expect(page.getByTestId("cta-total")).toHaveText(/: £20$/);
    await expect.poll(async () => (await dexieRows(page)).length).toBe(1);
  });
});
