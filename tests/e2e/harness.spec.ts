import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { holdRequests, mockKioskBackend } from "./fixtures/backend";
import { expect, test, type Page } from "./fixtures/kiosk";

/**
 * P9f — the harness proves its own rules (fixtures/kiosk.ts): a guard that never fires proves nothing.
 * Every case boots the same clean screen (Registration over the shared backend mock) and trips at most
 * ONE guard. The POSITIVE CONTROL runs that setup under the strictest settings, so a test.fail() case
 * can only fail on its own probe; a guard that stops firing turns its case into an unexpected pass.
 */

// No failure screenshot here: "only-on-failure" also shoots a test.fail() case whose body passed, and
// that round trip would land a late event for the teardown (hiding one that does not flush).
test.use({ screenshot: "off" });

const S3_PHOTO = "https://itemsposistnet.s3.ap-south-1.amazonaws.com/e2e-probe.png";

async function cleanRegistration(page: Page) {
  await mockKioskBackend(page);
  await page.goto("/");
  await expect(page.getByTestId("registration-screen")).toBeVisible();
}

/** A console line from the page, awaited until the harness has seen it. */
async function say(page: Page, level: "debug" | "error", text: string) {
  await Promise.all([
    page.waitForEvent("console", (m) => m.text() === text),
    page.evaluate(([l, t]) => console[l](t), [level, text] as const),
  ]);
}

test.describe("P9f harness self-check", () => {
  test.describe("strict console", () => {
    test.use({ strictConsole: true });

    test("POSITIVE CONTROL: a mocked boot to Registration trips no guard, even strict; a menu photo (S3) answers a 1×1 PNG", async ({
      page,
    }) => {
      await cleanRegistration(page);
      const photo = await page.evaluate(async (url) => {
        const response = await fetch(url);
        return { status: response.status, type: response.headers.get("content-type") };
      }, S3_PHOTO);
      expect(photo).toEqual({ status: 200, type: "image/png" });
    });

    test("CONSOLE ERROR, strict: fails the test", async ({ page }) => {
      test.fail();
      await cleanRegistration(page);
      await say(page, "error", "e2e probe");
    });

    test("CONSOLE ERROR, strict, declared: kiosk.allowConsoleError and Chromium's echo of a request failed on purpose pass", async ({
      page,
      kiosk,
    }) => {
      kiosk.allowConsoleError(/e2e probe/, "self-check");
      await cleanRegistration(page);
      await say(page, "error", "e2e probe");
      await page.route("**/api/e2e-500", (route) => route.fulfill({ status: 500, json: {} }));
      await Promise.all([
        page.waitForEvent("console", (m) => m.text().startsWith("Failed to load resource")),
        page.evaluate(() => fetch("/api/e2e-500").then((response) => response.status)),
      ]);
    });
  });

  test("CONSOLE ERROR, default: not judged", async ({ page }) => {
    await cleanRegistration(page);
    await say(page, "error", "e2e probe");
  });

  test("DENIED: a cross-origin call no page route answers fails the test, /api/ path or not", async ({ page }) => {
    test.fail();
    await cleanRegistration(page);
    // Not an /api/ path: only the cross-origin half of the deny can catch it.
    await page.evaluate(() => fetch("https://e2e-leak.invalid/probe").catch(() => undefined));
  });

  test("DENIED: an unmocked same-origin /api/ call fails the test", async ({ page }) => {
    test.fail();
    await page.goto("/");
    await expect(page.getByTestId("registration-screen")).toBeVisible();
    await page.evaluate(() => fetch("/api/e2e-unmocked").catch(() => undefined));
  });

  test("DENIED: a cross-origin call to a path the shared mock names fails the test — its named routes answer the backend only", async ({
    page,
  }) => {
    test.fail();
    await cleanRegistration(page);
    await page.evaluate(() => fetch("https://e2e-leak.invalid/api/cx/kiosk/getLanguage").catch(() => undefined));
  });

  test("DENIED: a cross-origin call to a held path fails the test — holdRequests parks the backend's calls only", async ({
    page,
  }) => {
    test.fail();
    await cleanRegistration(page);
    await holdRequests(page, "**/api/cx/kiosk/getMenu");
    // Parked instead, this fetch never settles: the test times out, never failing on the deny.
    await page.evaluate(() => fetch("https://e2e-leak.invalid/api/cx/kiosk/getMenu").catch(() => undefined));
  });

  test("RECS SEAM: tenant recommendations are off unless the spec sets the seam — a .env URL never reaches the deny", async ({
    page,
  }) => {
    await cleanRegistration(page);
    expect(await page.evaluate(() => (window as unknown as { __TB_RECS_URL__?: unknown }).__TB_RECS_URL__)).toBe("");
  });

  test("PAGE ERROR: an uncaught page error fails the test", async ({ page }) => {
    test.fail();
    await cleanRegistration(page);
    await Promise.all([
      page.waitForEvent("pageerror"),
      page.evaluate(() =>
        setTimeout(() => {
          throw new Error("e2e probe");
        }),
      ),
    ]);
  });

  test("PAGE ERROR, late: one the body's last step queued (setTimeout 0) still fails the test", async ({ page }) => {
    test.fail();
    await cleanRegistration(page);
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error("e2e probe");
      }),
    );
  });

  test("CLOSED PAGE: a body may close its page, the teardown still judges what it recorded", async ({ page }) => {
    await cleanRegistration(page);
    await page.close();
  });

  test("PAGE ERROR under page.clock: a timer throw the running clock swallows into console.error still fails the test", async ({ page }) => {
    test.fail();
    await page.clock.install();
    await cleanRegistration(page);
    await Promise.all([
      page.waitForEvent("console", (m) => m.text().includes("ClockController._callFirstTimer")),
      page.evaluate(() =>
        setTimeout(() => {
          throw new Error("e2e probe");
        }),
      ),
    ]);
  });

  test("PAGE ERROR, declared: kiosk.allowPageError lets the provoked one through", async ({ page, kiosk }) => {
    kiosk.allowPageError(/e2e probe/, "self-check");
    await cleanRegistration(page);
    await Promise.all([
      page.waitForEvent("pageerror"),
      page.evaluate(() =>
        setTimeout(() => {
          throw new Error("e2e probe");
        }),
      ),
    ]);
  });

  test("RAW I18N KEY: the app's own i18next reporting a missing key fails the test", async ({ page }) => {
    test.fail();
    await cleanRegistration(page);
    // The app's i18n instance (same module URL, same instance): t() of an unknown key → missingKey (dev debug).
    await Promise.all([
      page.waitForEvent("console", (m) => m.text().includes("missingKey en translation e2e.probe.missing")),
      page.evaluate(async (url) => (await import(url)).default.t("e2e.probe.missing"), "/src/i18n/index.ts"),
    ]);
  });

  test("DEV-SERVER RELOAD (console): Vite's HMR log fails the test", async ({ page }) => {
    test.fail();
    await cleanRegistration(page);
    await say(page, "debug", "[vite] hot updated: /src/e2e-probe.ts");
  });

  // Vite 8.3.1: an edit of a module with no HMR boundary (e.g. src/i18n/index.ts) sends full-reload and
  // reloads with no console line; a broken edit sends error (the overlay that swallows the next tap,
  // also silent); an HMR edit sends update. The witness: a one-frame WebSocket server on an OS-picked
  // port — the handshake, one text frame, close.
  for (const text of [
    '{"type":"full-reload","path":"*"}',
    '{"type":"update","updates":[{"type":"js-update","path":"/src/e2e-probe.ts"}]}',
    '{"type":"error","err":{"message":"e2e probe"}}',
  ]) {
    test(`DEV-SERVER RELOAD (HMR frame): ${(JSON.parse(text) as { type: string }).type} fails the test`, async ({
      page,
    }) => {
      test.fail();
      const frame = Buffer.from(text);
      const server = createServer().on("upgrade", (request, socket) => {
        const accept = createHash("sha1")
          .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        socket.end(
          Buffer.concat([
            Buffer.from(
              `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
            ),
            Buffer.from([0x81, frame.length]), // FIN + text, unmasked, length < 126
            frame,
          ]),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        await cleanRegistration(page);
        const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`;
        await Promise.all([
          page.waitForEvent("websocket", (ws) => ws.url() === url).then((ws) => ws.waitForEvent("framereceived")),
          page.evaluate((u) => void new WebSocket(u), url),
        ]);
      } finally {
        server.close();
      }
    });
  }
});
