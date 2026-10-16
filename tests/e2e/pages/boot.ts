/**
 * P9f page module — Registration, the splash, /second and the footer language sheet.
 * Plain functions named after the specs' own helpers, so a migration swaps a declaration for an import.
 */
import { expect, type Page } from "@playwright/test";

/** Type the licence on the on-screen keyboard and submit — boot starts. */
export async function submitLicence(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
}

/** Register on the on-screen keyboard and land on the splash. `timeout`: a throttled CPU (perf) needs more. */
export async function registerToStart(page: Page, timeout = 10_000) {
  await submitLicence(page);
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout });
}

/** Splash → order type (/second). */
export async function startToSecond(page: Page) {
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
}

/** /second → /menu (loyalty off). */
export async function pickPipelineToMenu(page: Page) {
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/** Splash → order type → `screen` (/menu, or /phone with loyalty on). */
export async function startOrderTo(page: Page, screen: "menu-screen" | "phone-screen", timeout = 15_000) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId(screen)).toBeVisible({ timeout });
}

/** Register on the on-screen keyboard and land on /menu. `timeout`: each leg's (default 10 s, then 15 s). */
export async function bootRegisteredToMenu(page: Page, timeout?: number) {
  await registerToStart(page, timeout);
  await startOrderTo(page, "menu-screen", timeout);
}

/** The hidden operator gesture (StartScreen's useLongPress): a 3 s hold in fake time (needs page.clock.install()). */
export async function holdHotspot(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(3_000);
  await page.mouse.up();
}

/** Footer language → the sheet → `code`: the sheet closes itself and <html lang> follows. */
export async function chooseLanguage(page: Page, code: "en" | "ar") {
  await page.getByTestId("footer-language").click();
  await expect(page.getByTestId("language-sheet")).toBeVisible();
  await page.getByTestId(`language-${code}`).click();
  await expect(page.getByTestId("language-sheet")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", code);
}
