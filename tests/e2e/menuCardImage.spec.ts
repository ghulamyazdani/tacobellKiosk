import { test, expect, type Locator, type Page } from "./fixtures/kiosk";
import { crc32, deflateSync } from "node:zlib";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  GREEK_SALAD,
  LARGE_FRIES,
  CHEESE_BURGER,
} from "./fixtures/backend";
import { bootRegisteredToMenu } from "./pages/boot";

/**
 * UB4 (user report 2026-10-08: "in the item card width of the item image
 * should be full and the image should be well adjusted so that the product
 * is visible") — the menu-card photo, measured in the running app.
 *
 * Kiosk item images are squares (512² / 1024² / 1080²). Drawn
 * `object-contain` in the 240×172 grid box (Figma 1:2609) or the 504×326
 * hero box (1:2597), a square became a centred 172² / 326² — 65–72 % of the
 * card. The fix: `object-cover` across the full card width at the frames'
 * box heights (fork ItemImage parity), the white background multiplied into
 * the card grey, and the names clamped (grid 2 lines, hero 3) so a long name
 * never shrinks the photo.
 *
 * Every S3 item image answers with a 512×512 PNG (generated here: white with
 * a centred dark product block — no binary fixture, no new dependency). The
 * painted width of the photo is natW × max(boxW / natW, boxH / natH) for
 * `cover` (and × min(…) for `contain`): it must reach the box width.
 *
 * Harness house order (P9f, newest route wins): the shared mock
 * (fixtures/backend.ts) serving cardMenu(), then this file's photo route —
 * a page route, so it wins over the harness's 1×1 photo stub. Boot is the
 * shared pages/boot.ts.
 */

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json; fixtures/backend.ts) ----
// GREEK_SALAD: badged NEW in the copy below → the 504-px arch-top hero.
// LARGE_FRIES: a grid card that gets a 60+ character name.
// CHEESE_BURGER: a grid card with its fixture name (one line).

/** Real TB India-length names (visual-order header): 70 and 62 characters. */
const HERO_NAME = "2 Value Rice Bowl Non Veg+1 Small Fries+1 Cinnamon Twists+2 Pepsi Zero";
const GRID_NAME = "Melted Cheese Quesadilla Veg + Seasoned Fries & Pepsi Party Box";

// ---- Mirrors src/components/stage/KioskStage.tsx (ada.spec.ts) ----
const STAGE_HEIGHT = 1920;
/** Figma 1:2609 / 1:2597 photo boxes (design px). */
const GRID_PHOTO = { width: 240, height: 172 };
const HERO_PHOTO = { width: 504, height: 326 };

/** A 512×512 RGB PNG: white, with a centred dark 256² "product". */
function squarePhoto(size = 512): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3, 0xff); // filter 0 + white pixels
    row[0] = 0;
    if (y >= size / 4 && y < (size * 3) / 4) row.fill(0x40, 1 + (size / 4) * 3, 1 + ((size * 3) / 4) * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const PHOTO = squarePhoto();

/** The slim menu, Greek Salad badged NEW (the hero), two long names. */
function cardMenu() {
  const menu = fixtureJson("slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities) {
        if (entity.id === GREEK_SALAD) {
          entity.badges = [{ name: "New" }];
          entity.name = HERO_NAME;
        }
        if (entity.id === LARGE_FRIES) entity.name = GRID_NAME;
      }
  return menu;
}

/** The shared mock serving cardMenu(); every S3 item image is PHOTO (header). */
async function mockKioskBackend(page: Page) {
  await mockBackend(page, { menu: cardMenu() });
  await page.route("https://itemsposistnet.s3.ap-south-1.amazonaws.com/**", (r) =>
    r.fulfill({ body: PHOTO, contentType: "image/png" })
  );
}

interface PhotoProbe {
  /** Card and photo boxes in stage design px. */
  cardWidth: number;
  boxWidth: number;
  boxHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  objectFit: string;
  blend: string;
  /** How wide the image itself is drawn (object-fit applied), design px. */
  paintedWidth: number;
  nameClamp: string;
}

/** The card's item photo (the one with an S3 src), measured once loaded. */
async function probePhoto(card: Locator): Promise<PhotoProbe> {
  const photo = card.locator('img[src^="https://itemsposistnet"]');
  await photo.scrollIntoViewIfNeeded();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(512);
  return photo.evaluate((img: HTMLImageElement, stageHeight) => {
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    if (!stage) throw new Error("kiosk-stage is not mounted");
    const k = stage.getBoundingClientRect().height / stageHeight;
    const cardEl = img.closest('[data-testid^="item-"]') as HTMLElement;
    const box = img.getBoundingClientRect();
    const style = getComputedStyle(img);
    const w = box.width / k;
    const h = box.height / k;
    const scale =
      style.objectFit === "cover"
        ? Math.max(w / img.naturalWidth, h / img.naturalHeight)
        : Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const name = cardEl.querySelector("p") as HTMLElement;
    return {
      cardWidth: Math.round(cardEl.getBoundingClientRect().width / k),
      boxWidth: Math.round(w),
      boxHeight: Math.round(h),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      objectFit: style.objectFit,
      blend: style.mixBlendMode,
      paintedWidth: Math.round(img.naturalWidth * scale),
      nameClamp: getComputedStyle(name).webkitLineClamp,
    };
  }, STAGE_HEIGHT);
}

test.describe("UB4 menu-card photo (Figma 1:2609 / 1:2597)", () => {
  test("GRID: the square photo fills the 240-px card (object-cover, painted ≥ the box), multiplied into the card grey", async ({
    page,
  }) => {
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    const probe = await probePhoto(page.getByTestId(`item-${CHEESE_BURGER}`));
    expect(probe.naturalWidth).toBe(512);
    expect(probe.naturalHeight).toBe(512);
    expect(probe.boxWidth).toBe(probe.cardWidth);
    expect(probe.cardWidth).toBe(GRID_PHOTO.width);
    expect(probe.boxHeight).toBe(GRID_PHOTO.height);
    expect(probe.objectFit).toBe("cover");
    expect(probe.blend).toBe("multiply");
    // contain painted 172 of the 240 (72 %); cover reaches the full width.
    expect(probe.paintedWidth).toBeGreaterThanOrEqual(probe.boxWidth);
    expect(probe.nameClamp).toBe("2");
  });

  test("HERO: the photo fills the 504-px arch card at 326 px, painted ≥ the box", async ({ page }) => {
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    const probe = await probePhoto(page.getByTestId(`item-${GREEK_SALAD}`));
    expect(probe.boxWidth).toBe(probe.cardWidth);
    expect(probe.cardWidth).toBe(HERO_PHOTO.width);
    expect(probe.objectFit).toBe("cover");
    expect(probe.blend).toBe("multiply");
    expect(probe.paintedWidth).toBeGreaterThanOrEqual(probe.boxWidth);
    // A 70-character name clamps at 3 lines: the photo keeps its full height.
    expect(probe.nameClamp).toBe("3");
    expect(probe.boxHeight).toBe(HERO_PHOTO.height);
  });

  test("LONG NAME: a 60+ character grid name clamps at 2 lines and the photo stays ≥ 160 px tall; the overlay keeps the full name", async ({
    page,
  }) => {
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    expect(GRID_NAME.length).toBeGreaterThanOrEqual(60);

    const card = page.getByTestId(`item-${LARGE_FRIES}`);
    const probe = await probePhoto(card);
    expect(probe.nameClamp).toBe("2");
    expect(probe.boxHeight).toBeGreaterThanOrEqual(160);
    expect(probe.boxWidth).toBe(probe.cardWidth);
    // The clamp hides the tail visually only: the accessible name is whole.
    await expect(card.getByRole("button", { name: GRID_NAME, exact: true })).toHaveCount(1);
    const nameBox = await card.locator("p").first().evaluate((p) => ({
      lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)),
      overflowing: p.scrollHeight > p.clientHeight + 1,
    }));
    expect(nameBox).toEqual({ lines: 2, overflowing: true });
  });
});
