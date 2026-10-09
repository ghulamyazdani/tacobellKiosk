import { test, expect, type Page } from "./fixtures/kiosk";
import { CHEESE_BURGER, EXTRA_PICKLES, fixtureJson, locale, mockKioskBackend } from "./fixtures/backend";
import { settle, shot } from "./fixtures/capture";
import { bootRegisteredToMenu } from "./pages/boot";

/**
 * User report 2026-10-09 ("why choose is not coming in some addons customizations"): add-on option
 * cards drew no button. Figma draws one on every Menu-Item_Medium card (PDP - Single Product 1:2614 /
 * 1:2728 Upgrades, Build Your Own Pack 1:5332), so every grid card now carries the CTA — the LABEL of
 * the card's own tap: CHOOSE, REMOVE once a tap would take the pick back, none on a swap group's pick.
 *
 * Fixture: Cheese Burger (£8) — "Choose From Extra" (0 / 3, one punch per item → cards): Extra
 * Pickles +£1, Extra Ketchup, Extra Mustard.
 */

const en = locale("en");
const EXTRA_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
const EXTRA_KETCHUP = "5dd1093f188e72ce1b3eb36a";
const EXTRA_MUSTARD = "5dd2f69029446a316cf7cf0b";
/** Wraps to 2 lines: with its price line and a CTA, the tallest content box (the name sits at card y 220). */
const LONG_NAME = "Extra Pickles With Sliced Jalapeños";

const card = (page: Page, id: string) => page.getByTestId(`pdp-option-${id}`);
const cta = (page: Page, id: string) => page.getByTestId(`pdp-option-cta-${id}`);

async function openBurgerPdp(page: Page) {
  const item = page.getByTestId(`item-${CHEESE_BURGER}`);
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
}

test.describe("add-on cards carry CHOOSE (user report 2026-10-09)", () => {
  test("ADD-ON GRID: every Extra card says CHOOSE; one tap picks ONCE (+£1) and the CTA turns REMOVE; REMOVE takes it back — Figma 1:2757's 280×60 outline at the card's foot", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openBurgerPdp(page);

    const group = page.getByTestId(`pdp-group-${EXTRA_GROUP}`);
    const count = (picked: number) =>
      en.pdp.groupCount.replace("{{count}}", String(picked)).replace("{{max}}", "3");
    for (const id of [EXTRA_PICKLES, EXTRA_KETCHUP, EXTRA_MUSTARD]) {
      await expect(cta(page, id)).toHaveText(en.pack.choose);
    }
    // Named by the item, DESCRIBED by its price line and CTA: a screen reader hears the price.
    await expect(card(page, EXTRA_PICKLES)).toHaveAccessibleName("Extra Pickles");
    await expect(card(page, EXTRA_PICKLES)).toHaveAccessibleDescription(new RegExp(`^\\+£1\\.00 ${en.pack.choose}$`, "i"));

    await cta(page, EXTRA_PICKLES).click();
    await expect(card(page, EXTRA_PICKLES)).toHaveAttribute("aria-pressed", "true");
    await expect(group).toContainText(count(1));
    await expect(cta(page, EXTRA_PICKLES)).toHaveText(en.pack.remove);
    await expect(card(page, EXTRA_PICKLES)).toHaveAccessibleDescription(new RegExp(`^\\+£1\\.00 ${en.pack.remove}$`, "i"));
    await expect(cta(page, EXTRA_KETCHUP)).toHaveText(en.pack.choose);
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");

    // Figma 1:2757 (CTA_Sheet_Fixed in a 328×400 card, p 24): 280×60, 24 px in from the foot.
    // Measured on the untapped card: a fresh pick is still scaling (tb-select).
    const [cardBox, ctaBox] = await Promise.all([
      card(page, EXTRA_KETCHUP).boundingBox(),
      cta(page, EXTRA_KETCHUP).boundingBox(),
    ]);
    if (!cardBox || !ctaBox) throw new Error("no card / CTA box");
    expect([Math.round(cardBox.width), Math.round(cardBox.height)]).toEqual([328, 400]);
    expect(Math.round(ctaBox.width)).toBe(280);
    expect(Math.round(ctaBox.height)).toBe(60);
    expect(Math.round(cardBox.x + cardBox.width - (ctaBox.x + ctaBox.width))).toBe(24);
    expect(Math.round(cardBox.y + cardBox.height - (ctaBox.y + ctaBox.height))).toBe(24);
    // CTA/Bold Medium on a 1 px Dark Purple outline (#501098), radius 4.
    const look = await cta(page, EXTRA_KETCHUP).evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.borderTopWidth, s.borderTopColor, s.borderTopLeftRadius, s.color, s.fontSize, s.lineHeight, s.fontWeight, s.textTransform];
    });
    expect(look).toEqual(["1px", "rgb(80, 16, 152)", "4px", "rgb(80, 16, 152)", "18px", "16px", "900", "uppercase"]);
    await shot(page, "pdp-addon-grid-choose-remove");

    await cta(page, EXTRA_PICKLES).click();
    await expect(card(page, EXTRA_PICKLES)).toHaveAttribute("aria-pressed", "false");
    await expect(group).toContainText(count(0));
    await expect(cta(page, EXTRA_PICKLES)).toHaveText(en.pack.choose);
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
  });

  test("SWAP GROUP: in a 1/1 group the pick carries no CTA (a tap only re-selects it) yet keeps its box — nothing moves; the other cards say CHOOSE — and CHOOSE swaps", async ({
    page,
  }) => {
    test.slow();
    const menu = fixtureJson("slim-menu.json");
    const extra = (menu.modifiers as { _id: string; constituentItems: { id: string; name: string }[] }[]).find(
      (g) => g._id === EXTRA_GROUP,
    );
    const pickles = extra?.constituentItems.find((item) => item.id === EXTRA_PICKLES);
    if (!extra || !pickles) throw new Error("fixture: no Extra group / Extra Pickles");
    Object.assign(extra, { min: 1, max: 1, multiplePunchMin: 1, multiplePunchMax: 1 });
    pickles.name = LONG_NAME;
    await mockKioskBackend(page, { menu });
    await bootRegisteredToMenu(page);
    await openBurgerPdp(page);

    // [the name's top in the card, the card's height]
    const layout = () =>
      card(page, EXTRA_PICKLES).evaluate((el, long) => {
        const name = [...el.querySelectorAll("span")].find((span) => span.textContent === long);
        const box = el.getBoundingClientRect();
        return [Math.round((name?.getBoundingClientRect().top ?? NaN) - box.top), Math.round(box.height)];
      }, LONG_NAME);
    await card(page, EXTRA_PICKLES).scrollIntoViewIfNeeded();
    expect(await layout()).toEqual([220, 400]);

    await cta(page, EXTRA_PICKLES).click();
    await expect(card(page, EXTRA_PICKLES)).toHaveAttribute("aria-pressed", "true");
    await expect(cta(page, EXTRA_PICKLES)).toHaveCount(0);
    expect(await layout(), "the pick's name and card stay put (its CTA's box is kept, hidden)").toEqual([220, 400]);
    await expect(cta(page, EXTRA_KETCHUP)).toHaveText(en.pack.choose);
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");

    // A tap on the pick keeps it (the engine re-selects) — no label claimed otherwise.
    await card(page, EXTRA_PICKLES).click();
    await expect(card(page, EXTRA_PICKLES)).toHaveAttribute("aria-pressed", "true");

    await cta(page, EXTRA_KETCHUP).click();
    await expect(card(page, EXTRA_KETCHUP)).toHaveAttribute("aria-pressed", "true");
    await expect(card(page, EXTRA_PICKLES)).toHaveAttribute("aria-pressed", "false");
    await expect(cta(page, EXTRA_KETCHUP)).toHaveCount(0);
    await expect(cta(page, EXTRA_PICKLES)).toHaveText(en.pack.choose);
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await expect(page.getByTestId("global-error")).toHaveCount(0);
  });

  test("EDGE HOLD (motion on): a press held on a card's outer band still picks it — the squeezed card keeps its whole hit area", async ({
    page,
  }) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openBurgerPdp(page);

    const pickles = card(page, EXTRA_PICKLES);
    await pickles.scrollIntoViewIfNeeded();
    await settle(page);
    const box = await pickles.boundingBox();
    if (!box) throw new Error("no card box");
    // 2 px inside the left edge; held until the 0.97 squeeze has pulled that edge ~5 px in.
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => pickles.evaluate((el) => getComputedStyle(el).scale)).toBe("0.97");
    await page.mouse.up();

    await expect(pickles).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
  });
});
