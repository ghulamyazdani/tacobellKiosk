import {
  test,
  expect,
  type CDPSession,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APP_ORIGIN } from "./fixtures/origin";

/**
 * Lane fonts — ONE self-hosted OFL family, Archivo variable (wght 100–900 ×
 * wdth 62–125; latin + latin-ext, which carries ₹), drives all three widths:
 * body 100 %, .tb-compressed 62 % / 700, .tb-display 125 % / 900. The
 * shipped bug (P1 → 2026-10-06, mislabelled files) rendered the body as a
 * static ExtraCondensed Thin and the compressed CTAs at NORMAL width, so this
 * measures rendered widths and asks DevTools which font drew the glyphs, not
 * only computed styles.
 *
 * The CSS `font` shorthand takes stretch KEYWORDS only: check/load accept
 * "extra-condensed 700 30px Archivo"; "700 62% 30px Archivo" is a SyntaxError.
 * check() is also true for a family with NO faces, so it only means something
 * beside the face list — and for ₹, before vs after latin-ext loads.
 *
 * Not automated: the offline boot from the service-worker precache (dev has no
 * SW). The evidence is the production build: dist/sw.js precaches both woff2
 * files and the built CSS keeps the weight/stretch/unicode-range descriptors.
 */

const LATIN = "Archivo-wdth-wght-latin.woff2";
const LATIN_EXT = "Archivo-wdth-wght-latin-ext.woff2";
/** What TB copy and an India deployment print; Ω (in neither subset) is the control. */
const GLYPHS = ["₹", "£", "€", "−", "…", "—", "·"];
const CONTROL = "Ω";
/** Has modifier groups, so a card tap opens the PDP. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";

const readJson = (relative: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8"));
const en = readJson("../../src/i18n/locales/en/translation.json") as {
  splash: { welcome: string };
};
const slimMenu = readJson("./fixtures/slim-menu.json");

const LOGIN_OK = {
  licenseDetails: {
    login_code: "mock-device-token",
    expiry_date: "2099-01-01T00:00:00.000Z",
  },
  deploymentDetails: {
    _id: "dep1",
    brand_id: "brand1",
    tenant_id: "tenant1",
    cluster_id: "cluster1",
  },
};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

/** Whether a FontFace.unicodeRange ("U+0-FF, U+131, …") covers `cp`. */
const covers = (range: string, cp: number) =>
  range.split(",").some((part) => {
    const [lo, hi = lo] = part
      .trim()
      .replace(/^U\+/i, "")
      .split("-")
      .map((hex) => parseInt(hex, 16));
    return cp >= lo && cp <= hi;
  });

/**
 * What drew the target's own text, per DevTools: "web" for an @font-face font,
 * else the platform family it fell back to. DevTools knows laid-out text only
 * ([] before layout) and a swap face draws in fallback until it loads — poll.
 */
async function renderedBy(cdp: CDPSession, target: Locator): Promise<string[]> {
  await target.evaluate((el) => el.setAttribute("data-font-probe", ""));
  try {
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "[data-font-probe]",
    });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return [...new Set(fonts.map((f) => (f.isCustomFont ? "web" : f.familyName)))].sort();
  } finally {
    await target.evaluate((el) => el.removeAttribute("data-font-probe"));
  }
}

async function fontCDP(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  return cdp;
}

async function expectFont(target: Locator, stretch: string, weight: string) {
  await expect(target).toHaveCSS("font-stretch", stretch);
  await expect(target).toHaveCSS("font-weight", weight);
}

/** House mock order: the `**\/api/**` catch-all FIRST, specific mocks after. */
async function mockKioskBackend(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees it.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  // Item photos live on S3: answered locally, the walk never needs the internet.
  await page.route("https://itemsposistnet.s3.ap-south-1.amazonaws.com/**", (r) =>
    r.fulfill({ body: PNG, contentType: "image/png" })
  );
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: {},
      },
    })
  );
  await page.route("**/api/cx/getCxSkinData", (r) =>
    r.fulfill({ json: { skin_id: "skin_1" } })
  );
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
    r.fulfill({ json: { start_order_text_primary: "START ORDER", ideal_time: "180" } })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
      ],
    })
  );
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
  // The deployment is India (user decision 2026-10-06): menu prices print ₹.
  await page.route("**/api/cx/kiosk/get_data", (r) =>
    r.fulfill({
      json: {
        charges: [],
        deployment: { countryCode: "IN", currencySettings: { symbol: "₹" } },
      },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

/** Register on the on-screen keyboard (digits behind the 123 layer) → the boot → the splash. */
async function registerToStart(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

test("Archivo faces: two variable faces (latin-ext only on demand, for ₹), keyword-only check(), measured widths per class, no fallback glyphs", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "token", value: "e2e-device-token", url: APP_ORIGIN },
  ]);
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees it.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.goto("/");
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible();

  // Exactly the two faces, both variable on both axes, both `swap` (`block`
  // would hide all text up to 3 s on a boot without the SW precache);
  // latin-ext FIRST so the later latin face wins the shared U+0304/0308/0329.
  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((f) => f.family.replace(/["']/g, "") === "Archivo")
      .map(({ weight, stretch, display, status, unicodeRange }) => ({
        weight,
        stretch,
        display,
        status,
        unicodeRange,
      }));
  });
  expect(faces.map((f) => [f.weight, f.stretch, f.display])).toEqual([
    ["100 900", "62% 125%", "swap"],
    ["100 900", "62% 125%", "swap"],
  ]);
  expect(faces.map((f) => covers(f.unicodeRange, 0x20b9))).toEqual([true, false]);
  // Latin drew these screens; latin-ext waits until a glyph needs it.
  expect(faces.map((f) => f.status)).toEqual(["unloaded", "loaded"]);

  const check = (font: string, text?: string) =>
    page.evaluate(
      ([font, text]) => {
        try {
          return document.fonts.check(font, text);
        } catch (error) {
          return (error as Error).name;
        }
      },
      [font, text] as const
    );
  expect(await check("extra-condensed 700 30px Archivo")).toBe(true);
  expect(await check("expanded 900 30px Archivo")).toBe(true);
  expect(await check("400 18px Archivo")).toBe(true);
  expect(await check("700 62% 30px Archivo")).toBe("SyntaxError");
  // On demand: ₹ is not drawable until latin-ext loads, then it is.
  expect(await check("400 40px Archivo", "₹")).toBe(false);
  const rupee = await page.evaluate(async () =>
    (await document.fonts.load("400 40px Archivo", "₹")).map((f) => ({
      status: f.status,
      unicodeRange: f.unicodeRange,
    }))
  );
  expect(rupee).toHaveLength(1);
  expect(rupee[0].status).toBe("loaded");
  expect(covers(rupee[0].unicodeRange, 0x20b9)).toBe(true);
  expect(await check("400 40px Archivo", "₹")).toBe(true);

  // Probe spans under the real stylesheet.
  const stage = page.getByTestId("kiosk-stage");
  const probe = await stage.evaluate((stage) => {
    const measure = (className: string, weight = "") => {
      const span = document.createElement("span");
      span.className = className;
      span.style.cssText = `font-size:30px;white-space:nowrap;${weight}`;
      span.textContent = "ORDER & PAY";
      stage.append(span);
      const style = getComputedStyle(span);
      return {
        stretch: style.fontStretch,
        weight: style.fontWeight,
        width: span.getBoundingClientRect().width,
      };
    };
    return {
      compressed: measure("tb-compressed"),
      display: measure("tb-display"),
      // Utilities override the @layer components classes (CTA/Expanded small).
      displayMedium: measure("tb-display font-medium"),
      body: measure(""),
      body700: measure("", "font-weight:700"),
      body900: measure("", "font-weight:900"),
    };
  });
  expect(probe.compressed).toMatchObject({ stretch: "62%", weight: "700" });
  expect(probe.display).toMatchObject({ stretch: "125%", weight: "900" });
  expect(probe.displayMedium).toMatchObject({ stretch: "125%", weight: "500" });
  expect(probe.body).toMatchObject({ stretch: "100%", weight: "400" });
  expect(probe.compressed.width).toBeLessThan(0.8 * probe.body700.width);
  expect(probe.display.width).toBeGreaterThan(1.1 * probe.body900.width);
  expect(probe.body.width).not.toBe(probe.body900.width);

  // No fallback glyphs, measured: a glyph Archivo lacks comes from the next
  // family, so it measures the same in "Archivo, X" as in X — for BOTH
  // generics (one pair alone can tie: the em dash is 1 em in Archivo and in
  // the serif). Blind spot: when neither generic has the glyph either (₹ on
  // macOS) the platform fallback depends on the first family and the pairs
  // differ anyway — DevTools below closes it.
  const fallsBack = await stage.evaluate(async (stage, chars) => {
    await document.fonts.load("400 40px Archivo", chars.join(""));
    const width = (family: string, text: string) => {
      const span = document.createElement("span");
      span.style.cssText = `font:400 40px ${family};white-space:pre`;
      span.textContent = text;
      stage.append(span);
      const measured = span.getBoundingClientRect().width;
      span.remove();
      return measured;
    };
    return Object.fromEntries(
      chars.map((ch) => {
        const run = ch.repeat(8);
        return [
          ch,
          width("Archivo, monospace", run) === width("monospace", run) &&
            width("Archivo, serif", run) === width("serif", run),
        ];
      })
    );
  }, [...GLYPHS, CONTROL]);
  expect(fallsBack).toEqual({
    ...Object.fromEntries(GLYPHS.map((ch) => [ch, false])),
    [CONTROL]: true,
  });

  // …and asked: DevTools names the font that drew each glyph.
  await stage.evaluate(async (stage, chars) => {
    for (const ch of chars) {
      await document.fonts.load("400 40px Archivo", ch);
      const span = document.createElement("span");
      span.dataset.glyph = ch;
      span.style.font = "400 40px Archivo, serif";
      span.textContent = ch;
      stage.append(span);
      // DevTools reports fonts for laid-out text only: lay it out now.
      span.getBoundingClientRect();
    }
  }, [...GLYPHS, CONTROL]);
  const cdp = await fontCDP(page);
  const drawnBy: Record<string, string[]> = {};
  for (const ch of [...GLYPHS, CONTROL]) {
    drawnBy[ch] = await renderedBy(cdp, page.locator(`[data-glyph="${ch}"]`));
  }
  expect(drawnBy).toEqual({
    ...Object.fromEntries(GLYPHS.map((ch) => [ch, ["web"]])),
    // Exactly one platform font, never the web font.
    [CONTROL]: [expect.stringMatching(/^(?!web$)/)],
  });
});

test("boot → /second → /menu → PDP with ₹ prices: real screens draw .tb-display 125 %/900, .tb-compressed 62 %/700 and body 100 % from the two same-origin Archivo files only", async ({
  page,
}) => {
  const requests: Request[] = [];
  page.on("request", (r) => requests.push(r));
  await mockKioskBackend(page);
  await registerToStart(page);
  const cdp = await fontCDP(page);

  // Splash WELCOME (1:5617, Title/H1 = Exp Bl).
  const welcome = page
    .getByTestId("start-screen")
    .getByText(en.splash.welcome, { exact: true });
  await expect(welcome).toHaveClass(/\btb-display\b/);
  await expectFont(welcome, "125%", "900");
  // The copy is lower case: the class sets the all-caps of the Figma lettering.
  await expect(welcome).toHaveCSS("text-transform", "uppercase");
  await expect.poll(() => renderedBy(cdp, welcome)).toEqual(["web"]);

  // /second (1:2581): the pipeline card label is Cm Bd; the footer labels are
  // CTA/Expanded small = Exp Md (`tb-display font-medium`: the utility wins
  // over the layered class).
  await page.getByTestId("start-screen").click();
  const cardLabel = page.getByTestId("pipeline-p1").locator(".tb-compressed");
  await expect(cardLabel).toHaveText("Dine In");
  await expectFont(cardLabel, "62%", "700");
  await expect(cardLabel).toHaveCSS("text-transform", "uppercase");
  await expect.poll(() => renderedBy(cdp, cardLabel)).toEqual(["web"]);
  const footerLabel = page.getByTestId("footer-language").locator(".tb-display");
  await expectFont(footerLabel, "125%", "500");

  // /menu: the CategoryRail (Cm Bd), a card name (body Md) and its ₹ price
  // (body Rg) — the ₹ glyph pulls latin-ext on demand.
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  const railItem = page.getByTestId("category-rail").getByRole("button").first();
  await expectFont(railItem, "62%", "700");
  await expect.poll(() => renderedBy(cdp, railItem)).toEqual(["web"]);
  const card = page.locator('[data-testid^="item-"]').first();
  const name = card.locator("p").first();
  const price = card.locator("p").nth(1);
  await expectFont(name, "100%", "500");
  await expect.poll(() => renderedBy(cdp, name)).toEqual(["web"]);
  await expect(price).toHaveText(/^₹\d/);
  await expectFont(price, "100%", "400");
  await expect.poll(() => renderedBy(cdp, price)).toEqual(["web"]);

  // The PDP title is Exp Bl (.tb-display), no longer the compressed cut.
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  const title = page.getByTestId("customization-screen").locator("h1");
  await expect(title).toHaveClass(/\btb-display\b/);
  await expectFont(title, "125%", "900");
  await expect.poll(() => renderedBy(cdp, title)).toEqual(["web"]);

  // Every font request of the walk: a same-origin .woff2 that loaded — both
  // files, nothing else — and nothing ever went to Google Fonts.
  const fonts = await Promise.all(
    requests
      .filter((r) => r.resourceType() === "font")
      .map(async (r) => {
        const url = new URL(r.url());
        return {
          origin: url.origin,
          file: url.pathname.split("/").pop() ?? "",
          status: (await r.response())?.status(),
        };
      })
  );
  expect(fonts.length).toBeGreaterThan(0);
  for (const font of fonts) {
    expect(font).toEqual({
      origin: APP_ORIGIN,
      file: expect.stringMatching(/\.woff2$/),
      status: 200,
    });
  }
  expect([...new Set(fonts.map((f) => f.file))].sort()).toEqual(
    [LATIN, LATIN_EXT].sort()
  );
  expect(
    requests
      .map((r) => new URL(r.url()).hostname)
      .filter((host) => /^fonts\.(googleapis|gstatic)\.com$/.test(host))
  ).toEqual([]);

  // OFL condition 2: the licence is served beside the fonts it covers (a
  // missing file still answers 200 — the SPA fallback — so check the text).
  const licence = await page.request.get("/fonts/OFL.txt");
  expect(await licence.text()).toContain("SIL Open Font License");
});
