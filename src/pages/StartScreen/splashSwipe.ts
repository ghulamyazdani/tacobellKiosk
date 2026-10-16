/**
 * The splash carousel's swipe (SplashMedia): its HARDWARE KNOBS and its pure
 * math, in stage px (1 stage px = 1 CSS px on the kiosk; the slop is CSS px).
 * No DOM.
 */

/**
 * HARDWARE KNOB. Past this (Euclidean) a press is a drag, never a tap: at or
 * above Chromium's 15 DIP touch slop, so every touch the browser still calls
 * a tap starts the order. Keep it ≥ the kiosk Chrome's --touch-slop-distance.
 * CSS px, NOT stage px — the browser's own unit, so it holds on a stage
 * scaled off 1 (a dev window, another panel or DPR) as well as on the kiosk.
 */
export const SWIPE_SLOP_PX = 16;
/** HARDWARE KNOB. A slow release past this share of a card steps to it. */
export const SWIPE_COMMIT = 0.3;
/** HARDWARE KNOB. A release at least this fast (px/ms)… */
export const SWIPE_FLICK_PX_MS = 0.3;
/** …after at least this much raw travel (16 px of visible follow) is a flick. */
export const SWIPE_FLICK_MIN_PX = 32;
/** HARDWARE KNOB. The release speed is read over the drag's last stretch (Chromium's kHorizonMS). */
export const SWIPE_VELOCITY_MS = 100;
/**
 * HARDWARE KNOB. A step's speed-matched settle, clamped. With the usual
 * ~550 px to go, a release under ~4.4 px/ms (an ordinary flick runs ~2)
 * settles in SETTLE_MAX_MS, so its card leaves faster than the finger.
 */
export const SETTLE_MIN_MS = 250;
export const SETTLE_MAX_MS = 500;

/** index.css --tb-splash-pitch / -focus / -side / -veil (splashSwipe.test pins them equal). */
export const PITCH = 751;
export const FOCUS = 1.1;
export const SIDE = 0.88;
export const VEIL = 0.45;

/** A point of the drag: [timeStamp ms, x stage px]. */
export type Sample = readonly [t: number, x: number];

/**
 * px/ms from the oldest sample in the last SWIPE_VELOCITY_MS to the release;
 * 0 when there is none (the finger had stopped). `samples` ascend in time.
 */
export function velocity(samples: readonly Sample[], [tUp, xUp]: Sample): number {
  const from = samples.find(([t]) => tUp - t <= SWIPE_VELOCITY_MS);
  return from && tUp > from[0] ? (xUp - from[1]) / (tUp - from[0]) : 0;
}

/**
 * The card a release lands on: −1 prev · 0 back to the slots · +1 next.
 * `p` = where the cards are in cards (positive toward next), `v` = px/ms
 * (negative = leftward), `travelPx` = the raw |dx|, `engaged` = the slop was
 * crossed sideways, `moved` = the finger's own share of p (p less where the
 * cards were caught). A flick lands on the nearest card in its own direction
 * (a fling back cancels); a slow release steps past SWIPE_COMMIT, never
 * against the drag (cards caught mid-flight sit up to a card off their slots
 * before the finger moves them). One card at most.
 */
export function target(p: number, v: number, travelPx: number, engaged: boolean, moved = p): -1 | 0 | 1 {
  if (!engaged) return 0;
  const flick = Math.abs(v) >= SWIPE_FLICK_PX_MS && travelPx >= SWIPE_FLICK_MIN_PX;
  const slow = p >= SWIPE_COMMIT && moved > 0 ? 1 : p <= -SWIPE_COMMIT && moved < 0 ? -1 : 0;
  const to = flick ? (v < 0 ? Math.ceil(p) : Math.floor(p)) : slow;
  return to > 0 ? 1 : to < 0 ? -1 : 0; // also folds Math.ceil's −0
}

/**
 * ViewPager's settle, 4·d/v: --tb-ease-out (cubic-bezier(.2, .8, .2, 1))
 * leaves at 4× its mean speed, so unclamped the card leaves at about the
 * finger's speed (clamped: see SETTLE_MAX_MS).
 */
export function settleMs(distPx: number, v: number): number {
  const ms = Math.round((4 * distPx) / Math.max(Math.abs(v), 0.01));
  return Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, ms));
}

/**
 * Focus follows position: a card `o` px off its slot scales 1.10 → 0.88 and
 * its veil darkens 0 → 0.45 over one pitch. `still` (reduced motion) keeps
 * the slot's own focus while the card is dragged.
 */
export function focusAt(slot: number, o: number, still = false): { scale: number; veil: number } {
  const u = Math.min(Math.abs(slot + (still ? 0 : o / PITCH)), 1);
  return { scale: FOCUS - (FOCUS - SIDE) * u, veil: VEIL * u };
}

/**
 * Where a release's entrant starts (@starting-style, the track's --tb-enter):
 * in formation, one pitch beyond the card that becomes the new peek — `o` is
 * where the finger left the row — but never on stage (a long drag's would
 * pop in): translated ≥ 540 + 340 × SIDE (≈ 839 px), a side-scale card is
 * wholly past the 1080 px stage's edge.
 */
export function enterAt(to: 1 | -1, o: number): number {
  const off = 540 + 340 * SIDE;
  return to > 0 ? Math.max(2 * PITCH + o, off) : Math.min(o - 2 * PITCH, -off);
}

/** The x and the scale of a computed `matrix(a, b, c, d, e, f)`; [0, 1] for anything else (none, jsdom). */
export function matrixOf(transform: string): [x: number, scale: number] {
  const m = /^matrix\(([^)]*)\)$/.exec(transform)?.[1].split(",").map(Number) ?? [];
  return m.length === 6 && m.every(Number.isFinite) ? [m[4], m[0]] : [0, 1];
}
