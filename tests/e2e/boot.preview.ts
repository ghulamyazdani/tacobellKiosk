import { GREEK_SALAD, mockKioskBackend } from "./fixtures/backend";
import { expect, test } from "./fixtures/kiosk";
import { bootRegisteredToMenu } from "./pages/boot";
import { addOneTap } from "./pages/order";

/**
 * The PRODUCTION bundle's boot path — playwright.config's "preview" project, its own invocation:
 *   TB_E2E_PREVIEW=1 TB_E2E_PORT=<lane port> yarn playwright test
 * (vite build + vite preview on that port; service workers blocked so page routes see every request).
 * Under the harness: no page error and no request past the mocks — in the build, not just the dev server.
 * (The raw-key and reload guards are dev-only: a build has no i18next debug log and no HMR socket.)
 */
test("PRODUCTION BUNDLE: the licence boots to the splash, the menu renders with its lazy chunk, a one-tap add lands — no dev module, no posthog", async ({
  page,
}) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });
  await mockKioskBackend(page);
  await bootRegisteredToMenu(page);
  await expect(page.getByTestId("category-rail")).toContainText("Side Orders");
  await addOneTap(page, GREEK_SALAD, "(1)");
  // The menu TOTAL is the bag's own (VAT 15 % in, rounded): round(17 × 1.15) = £20.
  await expect(page.getByTestId("cta-total")).toHaveText(/: £20$/);

  // A build, not the dev server: no dev module was served; /menu's entry pulled the lazy UI chunk; analytics off.
  expect(scripts.filter((path) => /^\/(src|node_modules|@)/.test(path))).toEqual([]);
  expect(scripts.some((path) => /^\/assets\/bagLazyParts-[\w-]+\.js$/.test(path))).toBe(true);
  expect(scripts.filter((path) => /posthog/i.test(path))).toEqual([]);
});
