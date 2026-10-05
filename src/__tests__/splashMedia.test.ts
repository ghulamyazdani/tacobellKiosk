import { describe, expect, it } from "vitest";
import {
  pickHomeScreenMedia,
  toSplashSlides,
} from "@cx-sdk/catalog/media/splashMedia";

/*
  P9d — the SDK splash-media engine (packages/catalog/src/media/splashMedia.ts),
  tested here because the SDK has no runner. Pure functions: the boot loader
  feeds pickHomeScreenMedia the raw getMedia body and stores its answer; the
  splash turns the stored list into slides with toSplashSlides. Both must be
  TOTAL — a promo payload problem may never throw into boot or the splash.
*/

const urls = (entries: { url?: unknown }[] | null) =>
  entries?.map((entry) => entry.url);

describe("pickHomeScreenMedia — getMedia body → this deployment's home_screen entries", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 0],
    ["a string", "<html>"],
    ["an array", []],
    ["an empty object (the e2e catch-all)", {}],
    ["media as an object", { media: {} }],
    ["media null", { media: null }],
    ["media a string", { media: "home_screen" }],
  ])("%s is not a getMedia answer → null (the host keeps its last-known media)", (_label, body) => {
    expect(pickHomeScreenMedia(body, "dep-1")).toBeNull();
  });

  it.each([
    ["no entries at all", { media: [] }],
    [
      "only junk and a menu banner",
      { media: [null, 3, "x", [], { key: "banner_image_primary", url: "banner.jpg" }] },
    ],
  ])("a valid body with %s → [] (the operator removed the splash media)", (_label, body) => {
    expect(pickHomeScreenMedia(body, "dep-1")).toEqual([]);
  });

  it("returns the root, then its extra_images, in payload order — the raw entries", () => {
    const root = {
      key: "home_screen",
      url: "root.jpg",
      media_type: "image",
      iteration_time: "5",
      extra_images: [{ url: "e1.jpg" }, { url: "e2.mp4", media_type: "mp4" }],
    };

    const picked = pickHomeScreenMedia(
      { media: [{ key: "banner_image_primary", url: "banner.jpg" }, root] },
      "dep-1"
    );

    expect(urls(picked)).toEqual(["root.jpg", "e1.jpg", "e2.mp4"]);
    expect(picked?.[0]).toBe(root);
    expect(picked?.[2]).toEqual({ url: "e2.mp4", media_type: "mp4" });
  });

  it("the LAST home_screen root wins, with only its own extras (the fork's forEach overwrite)", () => {
    const picked = pickHomeScreenMedia(
      {
        media: [
          { key: "home_screen", url: "old.jpg", extra_images: [{ url: "old-extra.jpg" }] },
          { key: "home_screen", url: "new.jpg", extra_images: [{ url: "new-extra.jpg" }] },
        ],
      },
      "dep-1"
    );

    expect(urls(picked)).toEqual(["new.jpg", "new-extra.jpg"]);
  });

  it("deployment scope: absent, null or [] = every store; listed = kept; unlisted = dropped — each entry on its own", () => {
    const picked = pickHomeScreenMedia(
      {
        media: [
          {
            key: "home_screen",
            url: "root-elsewhere.jpg",
            deployments: ["dep-2"],
            extra_images: [
              { url: "absent.jpg" },
              { url: "null.jpg", deployments: null },
              { url: "empty.jpg", deployments: [] },
              { url: "listed.jpg", deployments: ["dep-2", "dep-1"] },
              { url: "unlisted.jpg", deployments: ["dep-2"] },
            ],
          },
        ],
      },
      "dep-1"
    );

    expect(urls(picked)).toEqual(["absent.jpg", "null.jpg", "empty.jpg", "listed.jpg"]);
  });

  it.each([
    // The fork substring-matched a string — "dep-1,dep-2" would have matched.
    ["a string that contains this id", "dep-1,dep-2"],
    ["a string that IS this id", "dep-1"],
    ["an object", { _id: "dep-1" }],
    ["a number", 1],
    ["true", true],
  ])("a malformed deployments scope (%s) fails CLOSED — a store-scoped promo never goes fleet-wide", (_label, deployments) => {
    const picked = pickHomeScreenMedia(
      {
        media: [
          {
            key: "home_screen",
            url: "root.jpg",
            extra_images: [{ url: "scoped.jpg", deployments }],
          },
        ],
      },
      "dep-1"
    );

    expect(urls(picked)).toEqual(["root.jpg"]);
  });

  it("with no deployment id known, a store-scoped entry is dropped and unscoped ones stay", () => {
    const picked = pickHomeScreenMedia({
      media: [
        {
          key: "home_screen",
          url: "root.jpg",
          extra_images: [
            { url: "scoped.jpg", deployments: ["dep-1"] },
            { url: "null.jpg", deployments: null },
            { url: "empty.jpg", deployments: [] },
            { url: "malformed.jpg", deployments: "dep-1" },
          ],
        },
      ],
    });

    expect(urls(picked)).toEqual(["root.jpg", "null.jpg", "empty.jpg"]);
  });

  it("junk extras are skipped and a non-array extra_images is ignored — never a throw", () => {
    expect(
      urls(
        pickHomeScreenMedia(
          {
            media: [
              {
                key: "home_screen",
                url: "root.jpg",
                extra_images: [null, 7, "x.jpg", [{ url: "nested.jpg" }], { url: "ok.jpg" }],
              },
            ],
          },
          "dep-1"
        )
      )
    ).toEqual(["root.jpg", "ok.jpg"]);

    // A non-iterable (object, number) would throw if spread.
    for (const extra_images of ["nope", { url: "object.jpg" }, 7]) {
      expect(
        urls(
          pickHomeScreenMedia(
            { media: [{ key: "home_screen", url: "root.jpg", extra_images }] },
            "dep-1"
          )
        )
      ).toEqual(["root.jpg"]);
    }
  });
});

describe("toSplashSlides — stored mediaData → playable slides", () => {
  const slides = (home_screen: unknown) => toSplashSlides({ media: { home_screen } });

  it.each([
    ["null", null],
    ["a string", "media"],
    ["an empty object (fresh device)", {}],
    ["media null", { media: null }],
    ["media an array", { media: [] }],
    ["home_screen an object", { media: { home_screen: {} } }],
    ["home_screen a string", { media: { home_screen: "a.jpg" } }],
  ])("%s → no slides", (_label, mediaData) => {
    expect(toSplashSlides(mediaData)).toEqual([]);
  });

  it("drops entries with no usable url (the fork rendered an empty slide) and trims the rest", () => {
    expect(
      slides([
        { url: "" },
        { url: "   " },
        { url: 5 },
        { media_type: "mp4" },
        null,
        "a.jpg",
        [],
        { url: "  https://s3.example/a.jpg  " },
      ])
    ).toEqual([{ kind: "image", url: "https://s3.example/a.jpg", durationMs: 8000 }]);
  });

  it.each([
    ["media_type mp4", { url: "https://s3.example/x", media_type: "mp4" }],
    ["media_type MOV (any case, padded)", { url: "https://s3.example/x", media_type: " MOV " }],
    ["media_type m4v", { url: "https://s3.example/x", media_type: "m4v" }],
    ["media_type webm", { url: "https://s3.example/x", media_type: "webm" }],
    ["a .mp4 URL path", { url: "https://s3.example/promo.mp4" }],
    ["a .webm URL path with a signed query", { url: "https://s3.example/promo.webm?X-Amz-Signature=abc.jpg" }],
    ["a .MOV URL path with a fragment", { url: "https://s3.example/promo.MOV#t=0" }],
    ["a video URL even when typed image", { url: "https://s3.example/promo.m4v", media_type: "image" }],
  ])("%s → a video slide", (_label, entry) => {
    expect(slides([entry])).toEqual([
      expect.objectContaining({ kind: "video", url: entry.url.trim() }),
    ]);
  });

  it.each([
    ["media_type image", { url: "https://s3.example/x", media_type: "image" }],
    ["no media_type", { url: "https://s3.example/a.png" }],
    ["a video extension only in the query", { url: "https://s3.example/a.jpg?file=z.mp4" }],
    ["mp4 inside a word", { url: "https://s3.example/notmp4" }],
    ["a poster named after its video", { url: "https://s3.example/promo.mp4.jpg" }],
  ])("%s → an image slide", (_label, entry) => {
    expect(slides([entry])).toEqual([expect.objectContaining({ kind: "image" })]);
  });

  it.each([
    ["5 (number)", 5, 5000],
    ['"5" (string)', "5", 5000],
    ["exactly 3", 3, 3000],
    ["3.5", "3.5", 3500],
    ["just under 3", 2.99, 8000],
    ['"1" (the fork strobed at 1 s)', "1", 8000],
    ["0", 0, 8000],
    ["negative", -4, 8000],
    ["empty string", "", 8000],
    ["not a number", "abc", 8000],
    ["null", null, 8000],
    ["missing", undefined, 8000],
    ["Infinity", Infinity, 8000],
    ['"99999" (capped at 1 h)', "99999", 3_600_000],
  ])("image dwell for iteration_time %s (%s) → %i ms", (_label, iteration_time, durationMs) => {
    expect(slides([{ url: "a.jpg", iteration_time }])).toEqual([
      { kind: "image", url: "a.jpg", durationMs },
    ]);
  });

  it.each([
    ["2", 2, 2],
    ['"5"', "5", 5],
    ['"2.9" (floored)', "2.9", 2],
    ["1", 1, 1],
    ["0", 0, 1],
    ["negative", -4, 1],
    ["empty string", "", 1],
    ["not a number", "abc", 1],
    ["missing", undefined, 1],
    ["Infinity", Infinity, 1],
  ])("video plays for iteration_time %s (%s) → %i", (_label, iteration_time, plays) => {
    expect(slides([{ url: "v.mp4", iteration_time }])).toEqual([
      { kind: "video", url: "v.mp4", plays },
    ]);
  });

  it("keeps payload order across kinds", () => {
    expect(
      slides([{ url: "a.jpg" }, { url: "v.mp4" }, { url: "b.jpg", iteration_time: 4 }]).map(
        (slide) => `${slide.kind}:${slide.url}`
      )
    ).toEqual(["image:a.jpg", "video:v.mp4", "image:b.jpg"]);
  });

  it("round trip: what the boot loader stores is exactly what the splash plays", () => {
    const stored = pickHomeScreenMedia(
      {
        media: [
          {
            key: "home_screen",
            url: "root.jpg",
            iteration_time: "6",
            extra_images: [
              { url: "elsewhere.jpg", deployments: ["dep-2"] },
              { url: "promo.mp4", media_type: "mp4", iteration_time: "2" },
            ],
          },
        ],
      },
      "dep-1"
    );

    expect(toSplashSlides({ media: { home_screen: stored } })).toEqual([
      { kind: "image", url: "root.jpg", durationMs: 6000 },
      { kind: "video", url: "promo.mp4", plays: 2 },
    ]);
  });
});
