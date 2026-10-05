import { describe, expect, it } from "vitest";
import { resolveEntityImage } from "../entityImage";

/**
 * The generic grey photo glyph the backend parks in `image_url` for most
 * items (85 of 122 entities in the reference menu) and that the SDK resolver
 * returns as its own "no image" fallback. Rendering it is the bug this
 * resolver exists to prevent, so it must never come back out.
 */
const PLACEHOLDER =
  "https://itemsposistnet.s3.ap-south-1.amazonaws.com/common_image/image_jpg.jpeg";

const KIOSK_PNG = "https://cdn.example.com/kiosk/crunchwrap.png";
const KIOSK_JPG = "https://cdn.example.com/kiosk/crunchwrap.jpg";
const JAHEZ_PNG = "https://cdn.example.com/jahez/crunchwrap.png";
const REAL_MASTER = "https://cdn.example.com/hd/crunchwrap-master.png";

/**
 * Note the payload's spelling: `aggreagtorName` (sic). The SDK matches on
 * that exact key and reads it without an optional chain, so every fixture
 * entry carries it.
 */
const aggregatorEntry = (
  name: string,
  images: { png?: string; jpg?: string }
) => ({ aggreagtorName: name, ...images });

describe("resolveEntityImage (kiosk image source of truth)", () => {
  describe("kiosk aggregator entry — the preferred source", () => {
    it("prefers the kiosk entry's png", () => {
      expect(
        resolveEntityImage({
          image_url: PLACEHOLDER,
          aggregator_image: [aggregatorEntry("kiosk", { png: KIOSK_PNG, jpg: KIOSK_JPG })],
        })
      ).toBe(KIOSK_PNG);
    });

    it("falls back to the kiosk entry's jpg when there is no png", () => {
      expect(
        resolveEntityImage({
          image_url: PLACEHOLDER,
          aggregator_image: [aggregatorEntry("kiosk", { jpg: KIOSK_JPG })],
        })
      ).toBe(KIOSK_JPG);
    });

    it("matches the aggregator name case-insensitively", () => {
      for (const spelling of ["KIOSK", "Kiosk", "kIoSk"]) {
        expect(
          resolveEntityImage({
            image_url: PLACEHOLDER,
            aggregator_image: [aggregatorEntry(spelling, { png: KIOSK_PNG })],
          })
        ).toBe(KIOSK_PNG);
      }
    });

    it("wins over a real image_url — the kiosk asset is the one sized for this screen", () => {
      expect(
        resolveEntityImage({
          image_url: REAL_MASTER,
          aggregator_image: [aggregatorEntry("kiosk", { png: KIOSK_PNG })],
        })
      ).toBe(KIOSK_PNG);
    });

    it("picks the kiosk entry out of a mixed aggregator list", () => {
      expect(
        resolveEntityImage({
          image_url: PLACEHOLDER,
          aggregator_image: [
            aggregatorEntry("Jahez", { png: JAHEZ_PNG }),
            aggregatorEntry("Chefz", { jpg: "https://cdn.example.com/chefz/x.jpg" }),
            aggregatorEntry("kiosk", { png: KIOSK_PNG }),
          ],
        })
      ).toBe(KIOSK_PNG);
    });
  });

  describe("non-kiosk aggregators are never rendered", () => {
    it("returns null when only non-kiosk entries exist and image_url is the placeholder", () => {
      expect(
        resolveEntityImage({
          image_url: PLACEHOLDER,
          aggregator_image: [
            aggregatorEntry("Jahez", { png: JAHEZ_PNG }),
            aggregatorEntry("Chefz", { jpg: "https://cdn.example.com/chefz/x.jpg" }),
          ],
        })
      ).toBeNull();
    });

    it("falls through to a real image_url rather than borrowing the Jahez asset", () => {
      expect(
        resolveEntityImage({
          image_url: REAL_MASTER,
          aggregator_image: [aggregatorEntry("Jahez", { png: JAHEZ_PNG })],
        })
      ).toBe(REAL_MASTER);
    });
  });

  describe("the S3 placeholder is treated as 'no image'", () => {
    it("returns null when the kiosk entry itself points at the placeholder", () => {
      expect(
        resolveEntityImage({
          image_url: PLACEHOLDER,
          aggregator_image: [aggregatorEntry("kiosk", { png: PLACEHOLDER })],
        })
      ).toBeNull();
    });

    it("still reaches a real image_url when the kiosk entry is the placeholder", () => {
      expect(
        resolveEntityImage({
          image_url: REAL_MASTER,
          aggregator_image: [aggregatorEntry("kiosk", { jpg: PLACEHOLDER })],
        })
      ).toBe(REAL_MASTER);
    });

    it("returns null for a missing aggregator_image with a placeholder image_url", () => {
      expect(resolveEntityImage({ image_url: PLACEHOLDER })).toBeNull();
    });

    it("returns null for an empty aggregator_image with a placeholder image_url", () => {
      expect(
        resolveEntityImage({ image_url: PLACEHOLDER, aggregator_image: [] })
      ).toBeNull();
    });
  });

  describe("legacy image_url fallback (deployments with no aggregator feed)", () => {
    it("uses a real image_url when there is no aggregator entry at all", () => {
      expect(resolveEntityImage({ image_url: REAL_MASTER })).toBe(REAL_MASTER);
    });

    it("uses a real image_url when aggregator_image is an empty array", () => {
      expect(
        resolveEntityImage({ image_url: REAL_MASTER, aggregator_image: [] })
      ).toBe(REAL_MASTER);
    });

    it("ignores a non-string or empty image_url", () => {
      expect(resolveEntityImage({ image_url: "" })).toBeNull();
      expect(resolveEntityImage({ image_url: 42 })).toBeNull();
      expect(resolveEntityImage({ image_url: null })).toBeNull();
    });
  });

  describe("hostile input never throws (pre-hydration entities, nullable picks)", () => {
    it("returns null for null and undefined", () => {
      expect(resolveEntityImage(null)).toBeNull();
      expect(resolveEntityImage(undefined)).toBeNull();
    });

    it("returns null for garbage shapes", () => {
      expect(resolveEntityImage({})).toBeNull();
      expect(resolveEntityImage("not-an-entity")).toBeNull();
      expect(resolveEntityImage(42)).toBeNull();
      expect(resolveEntityImage([])).toBeNull();
    });
  });
});
