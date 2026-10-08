/**
 * P9f e2e harness. Migrated specs import EVERYTHING Playwright from here
 * (`export *` below), so the migration is one import line per spec.
 * The auto fixture makes the safety rules structural:
 *  - DEFAULT-DENY (context routes, the lowest priority): a request to any non-app origin, or any /api/
 *    call no page route answered, is aborted and fails the test at teardown. A spec ALLOWS a host by
 *    routing it with page.route (page routes always win).
 *  - The 657 menu photos (S3) answer a 1×1 PNG: no spec needs the internet.
 *  - STRICT: uncaught page errors, i18next missingKey (a raw key on screen), dev-server reloads mid-test.
 *  - console.error is judged only under test.use({ strictConsole: true }) (the flows).
 */
import { test as base, expect, type Page } from "@playwright/test";

export * from "@playwright/test";

export const PROMPT_AFTER_MS = 100_000; // idle prompt at 100 s; Splash at 120 s (the prompt is the last 20 s)
export const PROMPT_WINDOW_MS = 20_000;
export const REQUEST_BUDGET_MS = 10_000; // TB transport default budget (P9b)
export const MENU_BUDGET_MS = 30_000; // getMenu's budget

const MENU_PHOTOS = "https://itemsposistnet.s3.ap-south-1.amazonaws.com/**";
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
); // the same bytes fonts.spec already serves

/**
 * Vite 8's client LOGS an HMR update (console.debug) and a lost server (console.log), but reloads
 * the page for a full-reload WITHOUT a word — so the HMR socket's own frames are read too (an
 * "error" frame = a broken edit elsewhere: the overlay that would swallow the next tap).
 */
const VITE_CONSOLE = /^\[vite\] (hot updated|css hot updated|server connection lost)/;
const VITE_FRAME = /"type":"(full-reload|update|error)"/;

interface Allow {
  text: RegExp;
  why: string;
}

export interface Kiosk {
  /** An uncaught page error THIS test provokes on purpose. */
  allowPageError(text: RegExp, why: string): void;
  /** A console.error THIS test provokes on purpose (matters only under strictConsole). */
  allowConsoleError(text: RegExp, why: string): void;
}

export const test = base.extend<{ kiosk: Kiosk; strictConsole: boolean }>({
  strictConsole: [false, { option: true }],
  kiosk: [
    async ({ page, context, baseURL, strictConsole }, provide) => {
      const app = new URL(baseURL ?? "http://localhost:5373").origin;
      const denied: string[] = [];
      const pageErrors: string[] = [];
      const consoleErrors: { text: string; url: string }[] = [];
      const missingKeys: string[] = [];
      const reloads: string[] = [];
      const failed = new Set<string>();
      // No suite-wide allow list: the 2026-10-08 harvest (29 specs) found no benign page error to share.
      const pageAllow: Allow[] = [];
      const consoleAllow: Allow[] = [];

      await context.route(
        (url) => url.origin !== app || url.pathname.startsWith("/api/"),
        (route) => {
          denied.push(`${route.request().method()} ${route.request().url()}`);
          return route.abort("blockedbyclient").catch(() => undefined);
        },
      );
      await context.route(MENU_PHOTOS, (route) =>
        route.fulfill({ body: PNG_1X1, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" } }),
      );
      page.on("pageerror", (e) => pageErrors.push(e.stack ?? `${e.name}: ${e.message}`));
      page.on("console", (m) => {
        const text = m.text();
        if (VITE_CONSOLE.test(text)) reloads.push(text);
        else if (text.includes("i18next::translator: missingKey")) missingKeys.push(text);
        // A RUNNING page.clock catches a page timer's throw and console.error()s it (never a pageerror);
        // the stack names the clock's own frame. ponytail: an app console.error(e) of an error it caught
        // inside a clock-fired timer reads the same (none in src today); Playwright renaming the frame
        // turns harness.spec "PAGE ERROR under page.clock" into an unexpected pass.
        else if (m.type() === "error" && text.includes("ClockController._callFirstTimer")) pageErrors.push(text);
        else if (strictConsole && m.type() === "error") consoleErrors.push({ text, url: m.location().url });
      });
      page.on("websocket", (ws) =>
        ws.on("framereceived", ({ payload }) => {
          const frame = String(payload);
          if (VITE_FRAME.test(frame)) reloads.push(`HMR frame ${frame.slice(0, 200)}`);
        }),
      );
      if (strictConsole) {
        page.on("requestfailed", (r) => failed.add(r.url()));
        page.on("response", (r) => {
          if (r.status() >= 400) failed.add(r.url());
        });
      }

      await provide({
        allowPageError: (text, why) => void pageAllow.push({ text, why }),
        allowConsoleError: (text, why) => void consoleAllow.push({ text, why }),
      });

      // One round trip lands what the body's last step already queued (a setTimeout(0) throw).
      // A body may close its page: then there is nothing to flush or unroute.
      if (!page.isClosed()) await page.evaluate(() => 0).catch(() => undefined);
      // Snapshot BEFORE dropping the spec's routes: nothing after the body may count.
      const seen = {
        denied: [...denied],
        pageErrors: pageErrors.filter((e) => !pageAllow.some((a) => a.text.test(e))),
        consoleErrors: consoleErrors
          // Chromium's echo of a request this test failed on purpose (a mocked ≥400 or an abort).
          .filter((e) => !(e.text.startsWith("Failed to load resource") && failed.has(e.url)))
          .filter((e) => !consoleAllow.some((a) => a.text.test(e.text)))
          .map((e) => `${e.text} (${e.url})`),
        missingKeys: [...missingKeys],
        reloads: [...reloads],
      };
      if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" }); // parked routes are never answered
      expect(
        seen,
        "kiosk harness: denied requests / uncaught page errors / console errors (strictConsole) / raw i18n keys / dev-server reloads",
      ).toEqual({ denied: [], pageErrors: [], consoleErrors: [], missingKeys: [], reloads: [] });
    },
    { auto: true },
  ],
});

/* ---- time (page.clock) ---- */
export const fakeNow = (page: Page) => page.evaluate(() => Date.now());
/** paytm.spec freezeClock verbatim: pause where it stands (+1 s); pauseAt refuses the past, so retry twice. */
export async function freezeClock(page: Page) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.clock.pauseAt((await fakeNow(page)) + 1_000);
      return;
    } catch (error) {
      if (attempt === 3 || !String(error).includes("past")) throw error;
    }
  }
}
/**
 * Fake time in small steps until done() holds — for timer chains the page re-arms itself (push backoff,
 * boot retry, Paytm polls). `gate`: step only while it holds (paytm: no request in flight).
 */
export async function stepClockUntil(
  page: Page,
  done: () => boolean | Promise<boolean>,
  { stepMs = 500, timeout = 20_000, gate }: { stepMs?: number; timeout?: number; gate?: () => Promise<boolean> } = {},
) {
  await expect
    .poll(
      async () => {
        if (!gate || (await gate())) await page.clock.runFor(stepMs);
        return done();
      },
      { timeout, intervals: [50] },
    )
    .toBe(true);
}
/** Step until the page's fake now reaches `at` (overshoots by < stepMs). */
export const stepClockTo = (
  page: Page,
  at: number,
  opts: { stepMs?: number; timeout?: number; gate?: () => Promise<boolean> } = {},
) => stepClockUntil(page, async () => (await fakeNow(page)) >= at, { stepMs: 4_000, timeout: 90_000, ...opts });

/* ---- read-only state probes ---- */
/** Rows of a KioskDB (Dexie) table. cartItems = the cart mirror a reload restores. */
export function dexieRows(page: Page, table = "cartItems"): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const open = indexedDB.open("KioskDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name, "readonly").objectStore(name).getAll();
          request.onsuccess = () => {
            db.close();
            resolve(request.result as Record<string, unknown>[]);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      }),
    table,
  );
}
/** One slice of redux-persist's persist:root ({} when absent; recovery.persistedLoyalty semantics). */
export function persistedSlice<T = Record<string, unknown>>(page: Page, slice: string): Promise<T> {
  return page.evaluate((name) => {
    const raw = window.localStorage.getItem("persist:root");
    const value = raw ? (JSON.parse(raw) as Record<string, string>)[name] : undefined;
    return value ? JSON.parse(value) : {};
  }, slice) as Promise<T>;
}
/** idle.spec / loyalty.spec persistedLoyaltyPoints verbatim (NaN when absent). */
export function persistedLoyaltyPoints(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("persist:root");
    if (!raw) return Number.NaN;
    const root = JSON.parse(raw) as Record<string, string>;
    if (!root.loyalty) return Number.NaN;
    const loyalty = JSON.parse(root.loyalty) as { totalLoyaltyPoints?: number };
    return Number(loyalty.totalLoyaltyPoints);
  });
}
