import { getImageUrlFromAggregator } from "@cx-sdk/catalog/menu/menuUtils";

/**
 * The SDK resolver's hard-coded "no image" fallback
 * (`menuUtils.getImageUrlFromAggregator`). It is a generic grey photo glyph,
 * so rendering it makes every imageless item look broken — we treat it as
 * "no image" and let callers omit the <img> instead.
 */
const SDK_PLACEHOLDER =
  "https://itemsposistnet.s3.ap-south-1.amazonaws.com/common_image/image_jpg.jpeg";

/**
 * THE image source for anything that came out of the menu converter: menu
 * entities, variants, modifier constituent items, cart rows (they spread the
 * entity), offer/loyalty reward tiles.
 *
 * Why not `entity.image_url`: that field is the item's HD/master image and on
 * a real deployment it is the generic S3 placeholder for most items (85 of 122
 * in the reference menu). The image the KIOSK is meant to show lives in
 * `aggregator_image[]` under the `"kiosk"` entry (payload spells the key
 * `aggreagtorName`, sic) — which is exactly what posistKiosk renders on every
 * card via `getImageUrlFromAggregator(entity, true)`. Items with no kiosk
 * entry have a placeholder `image_url` too, so nothing is lost by preferring
 * the aggregator path.
 *
 * @returns a usable URL, or null when the item genuinely has no image — so
 *   callers keep their `{url && <img/>}` guard and render nothing rather than
 *   a broken-looking placeholder.
 */
export function resolveEntityImage(entity: unknown): string | null {
  const resolved = getImageUrlFromAggregator(
    entity as Parameters<typeof getImageUrlFromAggregator>[0],
    true,
  );
  if (resolved && resolved !== SDK_PLACEHOLDER) return resolved;

  // Last resort for deployments that ship a real master image and no
  // aggregator entry. Still skips the placeholder.
  const legacy = (entity as { image_url?: unknown } | null | undefined)
    ?.image_url;
  if (typeof legacy === "string" && legacy && legacy !== SDK_PLACEHOLDER) {
    return legacy;
  }
  return null;
}
