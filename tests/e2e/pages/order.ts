/**
 * P9f page module — the menu, the PDP, the bag and the numpad.
 * Plain functions named after the specs' own helpers, so a migration swaps a declaration for an import.
 */
import { expect, type Page } from "@playwright/test";

/** A plain item lands with one tap, no modal. */
export async function addOneTap(page: Page, entityId: string, expectedCount: string) {
  const card = page.getByTestId(`item-${entityId}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
}

/**
 * Menu card tap → the PDP → (optional addon pick) → commit → dismiss the added modal
 * (customized adds always confirm).
 */
export async function addViaPdp(
  page: Page,
  entityId: string,
  { addonId, expectedCta }: { addonId?: string; expectedCta: string },
) {
  const card = page.getByTestId(`item-${entityId}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  if (addonId) {
    await page.getByTestId(`pdp-option-${addonId}`).click();
  }
  await expect(page.getByTestId("pdp-add-to-bag")).toContainText(expectedCta);
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-added-modal")).toBeVisible();
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).not.toBeVisible();
}

/** VIEW MY BAG → /cart. */
export async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/cart$/);
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

export const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');
export const loyaltyRows = (page: Page) => page.locator('[data-testid^="bag-loyalty-row-"]');

/** The bag's offers entry → the rewards sheet. */
export async function openRewardsSheet(page: Page) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
}

/** KioskNumpad is the only numeric keypad mounted at a time. */
export async function typeDigits(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByTestId(`numpad-key-${digit}`).click();
  }
}

/**
 * A rail tap → its section in view. On slim-menu both sections fit the pane at load, so this cannot
 * prove the tap scrolled: a spec that needs that asserts the section MOVED (flows/happy-path).
 */
export async function selectCategory(page: Page, id: string) {
  await page.getByTestId(`rail-${id}`).click();
  await expect(page.getByTestId(`section-${id}`)).toBeInViewport();
}
