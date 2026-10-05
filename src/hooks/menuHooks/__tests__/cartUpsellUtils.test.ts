import { describe, expect, it } from "vitest";
import {
  cartUpsellGridCapacity,
  CART_UPSELL_ACCESSIBLE_HEIGHT_FRACTION,
  CART_UPSELL_CARD_HEIGHT_PX,
  CART_UPSELL_CARD_WIDTH_PX,
  CART_UPSELL_GRID_GAP_PX,
  CART_UPSELL_IMAGE_HEIGHT_PX,
  CART_UPSELL_MAX_ROWS,
  CART_UPSELL_PAGE_PADDING_X_PX,
  CART_UPSELL_REFERENCE_CAPACITY,
  CART_UPSELL_TEXT_BLOCK_HEIGHT_PX,
} from "../cartUpsellUtils";
import {
  ADA_REACH_ZONE_HEIGHT,
  STAGE_HEIGHT,
} from "../../../components/stage/KioskStage";

/*
  Capacity is the ONLY thing standing between the /forYou grid and a page that
  cannot scroll. Overshoot by one row and the primary button plus the back link
  leave the screen, on hardware with no scroll gesture to bring them back — a
  stranded customer (Rule 1), not a cosmetic overflow. So these are flow tests
  wearing arithmetic.

  Deliberately property-shaped rather than a table of magic numbers, EXCEPT for
  the reference kiosk (1080x1920), which is the real hardware and is pinned
  exactly: the /forYou suite and the e2e spec both assume 16 / 8.
*/

/** The real hardware. */
const KIOSK_W = 1080;
const KIOSK_H = 1920;

describe("cartUpsellGridCapacity", () => {
  describe("the reference kiosk (1080x1920)", () => {
    it("fits 4 across and 4 down", () => {
      expect(cartUpsellGridCapacity(KIOSK_W, KIOSK_H, false)).toBe(16);
    });

    it("is the capacity the pure telemetry helpers bind", () => {
      // buildCartUpsellBreakdown/explainCartUpsellExclusions have no DOM to
      // measure, so they split shown vs hidden against this constant. If it
      // ever drifts from the real grid, above_fold silently starts lying.
      expect(CART_UPSELL_REFERENCE_CAPACITY).toBe(
        cartUpsellGridCapacity(KIOSK_W, KIOSK_H, false),
      );
    });

    it("shows half as many rows in accessibility mode", () => {
      expect(cartUpsellGridCapacity(KIOSK_W, KIOSK_H, true)).toBe(8);
    });

    it("is worth a grid at all — more than a single row of suggestions", () => {
      expect(cartUpsellGridCapacity(KIOSK_W, KIOSK_H, false)).toBeGreaterThan(
        3,
      );
    });

    it("lays its columns out inside the page padding, exactly", () => {
      // 4*240 + 3*24 = 1032 = 1080 - 2*24. The page applies the SAME constants
      // inline, so a change to either side that broke this would overflow a
      // row horizontally on a page that cannot scroll in that axis either.
      const columns = 4;
      const track =
        columns * CART_UPSELL_CARD_WIDTH_PX +
        (columns - 1) * CART_UPSELL_GRID_GAP_PX;
      expect(track).toBe(KIOSK_W - 2 * CART_UPSELL_PAGE_PADDING_X_PX);
      expect(track).toBeLessThanOrEqual(
        KIOSK_W - 2 * CART_UPSELL_PAGE_PADDING_X_PX,
      );
    });
  });

  describe("it responds to the viewport rather than hardcoding the fleet", () => {
    it("a wider screen earns more columns", () => {
      const narrow = cartUpsellGridCapacity(KIOSK_W, KIOSK_H, false);
      const wide = cartUpsellGridCapacity(1920, KIOSK_H, false);

      expect(wide).toBeGreaterThan(narrow);
    });

    it("a taller screen earns more rows, up to the merchandising cap", () => {
      const short = cartUpsellGridCapacity(KIOSK_W, 900, false);
      const tall = cartUpsellGridCapacity(KIOSK_W, KIOSK_H, false);

      expect(tall).toBeGreaterThan(short);
    });

    it("accessibility mode never offers MORE than the standard layout", () => {
      for (const height of [900, 1280, KIOSK_H, 2400]) {
        expect(
          cartUpsellGridCapacity(KIOSK_W, height, true),
        ).toBeLessThanOrEqual(cartUpsellGridCapacity(KIOSK_W, height, false));
      }
    });

    it("shrinks the usable height by the accessible fraction, not the width", () => {
      // Same columns, fewer rows — the accessible layout drops the content
      // into the lower part of the stage, it does not narrow it.
      const standard = cartUpsellGridCapacity(KIOSK_W, KIOSK_H, false);
      const accessible = cartUpsellGridCapacity(KIOSK_W, KIOSK_H, true);
      expect(standard % 4).toBe(0);
      expect(accessible % 4).toBe(0);
      expect(CART_UPSELL_ACCESSIBLE_HEIGHT_FRACTION).toBeLessThan(1);
    });

    it("takes the accessible fraction from the ADA reach zone, not the fork's 60vh (P9c)", () => {
      // ReachZone renders every page into the bottom ADA_REACH_ZONE_HEIGHT px,
      // so a retune of the calibration knob must move the grid budget too.
      expect(CART_UPSELL_ACCESSIBLE_HEIGHT_FRACTION).toBe(
        ADA_REACH_ZONE_HEIGHT / STAGE_HEIGHT,
      );
    });
  });

  describe("it refuses to produce a wall of cards", () => {
    it("caps rows at CART_UPSELL_MAX_ROWS however tall the screen claims to be", () => {
      const absurd = cartUpsellGridCapacity(KIOSK_W, 20000, false);

      expect(absurd).toBe(4 * CART_UPSELL_MAX_ROWS);
      // A tenant who flags forty items gets a suggestion grid, not a wall.
      expect(absurd).toBe(cartUpsellGridCapacity(KIOSK_W, KIOSK_H, false));
    });

    it("caps in accessibility mode too", () => {
      expect(cartUpsellGridCapacity(KIOSK_W, 20000, true)).toBe(
        4 * CART_UPSELL_MAX_ROWS,
      );
    });
  });

  describe("it floors at one card, whatever the viewport reports", () => {
    /*
      A bad measurement must degrade to a cramped screen, never to an EMPTY
      one: /forYou renders `snapshot.slice(0, capacity)`, so a capacity of 0
      would leave the customer staring at a heading and two buttons with no
      offer at all — worse than the screen not appearing.
    */
    it.each<[string, number, number]>([
      ["zero", 0, 0],
      ["negative", -100, -100],
      ["not a number", Number.NaN, Number.NaN],
      ["infinite", Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      ["narrower than one card", 100, 200],
    ])("%s viewport still fits at least one card", (_label, width, height) => {
      expect(
        cartUpsellGridCapacity(width, height, false),
      ).toBeGreaterThanOrEqual(1);
      expect(
        cartUpsellGridCapacity(width, height, true),
      ).toBeGreaterThanOrEqual(1);
    });

    it("never returns a fractional or non-finite count", () => {
      const viewports: [number, number][] = [
        [KIOSK_W, KIOSK_H],
        [0, 0],
        [777, 1333],
        [Number.NaN, 640],
      ];
      for (const [w, h] of viewports) {
        const capacity = cartUpsellGridCapacity(w, h, false);
        expect(Number.isInteger(capacity)).toBe(true);
        expect(capacity).toBeGreaterThan(0);
      }
    });
  });

  describe("the card box the capacity math is derived from", () => {
    it("matches the Figma Menu-Item card the shared tile renders", () => {
      // The card sets these same constants inline; capacity assumes them. If
      // the two ever disagreed the grid would overflow by whole rows.
      expect(CART_UPSELL_CARD_WIDTH_PX).toBe(240);
      expect(CART_UPSELL_CARD_HEIGHT_PX).toBe(277);
      expect(CART_UPSELL_CARD_HEIGHT_PX).toBe(
        CART_UPSELL_IMAGE_HEIGHT_PX + CART_UPSELL_TEXT_BLOCK_HEIGHT_PX,
      );
    });

    it("keeps four rows plus chrome inside the kiosk's own height", () => {
      const rows = CART_UPSELL_MAX_ROWS;
      const gridHeight =
        rows * CART_UPSELL_CARD_HEIGHT_PX +
        (rows - 1) * CART_UPSELL_GRID_GAP_PX;
      expect(gridHeight).toBeLessThan(KIOSK_H);
    });
  });
});
