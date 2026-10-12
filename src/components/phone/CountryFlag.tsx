import { useState } from "react";

/**
 * A round country flag — restroGo's CountryDropdown look (user request
 * 2026-10-12): a pale disc in a 2 px light-purple ring, the flag
 * cover-fitted inside. The size is the host's (`className`).
 *
 * Self-hosted by URL convention — public/flags/<code>.png, flagcdn.com's
 * w160 artwork (public/flags/NOTICE.txt) — so no URL table ships in JS and
 * the Workbox precache serves every flag offline; never a runtime CDN. An
 * image that fails (offline before the service worker installs, a bad
 * deploy) shows the code in the same circle, never a broken image.
 * Decorative: hidden from assistive tech, the host's own label names the
 * country.
 */
export default function CountryFlag({ code, className }: { code: string; className: string }) {
  // The code whose image failed: a later code gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-tb-purple/10 bg-tb-grey-6 text-[20px] font-bold leading-none text-tb-ink-purple ${className}`}
    >
      {failed === code ? (
        code
      ) : (
        <img
          alt=""
          src={`/flags/${code.toLowerCase()}.png`}
          onError={() => setFailed(code)}
          // Chrome paints its broken-image icon in a sized <img> from the
          // moment a load fails, often a frame before the error event swaps
          // in the code: ::after renders only on a broken image and covers
          // it with the disc.
          className="relative h-full w-full object-cover after:absolute after:inset-0 after:bg-tb-grey-6"
        />
      )}
    </span>
  );
}
