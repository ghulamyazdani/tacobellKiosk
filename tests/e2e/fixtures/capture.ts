/**
 * P9f harness — capture-only screenshots for the flows (user decision 2026-10-05: no pixel
 * diffing). The visual-* walks keep their own capture() (settle + shot + soft clippedText).
 */
import { expect, test, type Page } from "@playwright/test";

/**
 * visual-bagpdp settle verbatim: every <img> complete and every finite CSS keyframe animation (sheet
 * and dialog entrances) at rest; an infinite pulse is exempt.
 */
export async function settle(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Array.from(document.images).every((img) => img.complete) &&
          document
            .getAnimations()
            .every(
              (animation) =>
                !(animation instanceof CSSAnimation) ||
                animation.playState !== "running" ||
                !Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity),
            ),
      ),
    )
    .toBe(true);
}

/** The five identical visual-* copies: fonts ready → a still screenshot attached to the report. */
export async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
}
