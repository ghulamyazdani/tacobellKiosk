/** P9f page module — /payment. */
import { expect, type Page } from "@playwright/test";

/**
 * PAY AT COUNTER → its 3 s cancel window in fake time → /receipt. Needs an installed, RUNNING
 * page.clock; the window's own contract (cancel, nothing sent) is checkout.spec's.
 */
export async function payAtCounter(page: Page) {
  await page.getByTestId("payment-counter").click();
  // The window's timer is armed by the commit that shows it: wait for it, then step past it.
  await expect(page.getByTestId("payment-buffer")).toBeVisible();
  await page.clock.runFor(3_000);
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
}
