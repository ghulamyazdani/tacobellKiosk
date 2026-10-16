/**
 * The splash carousel's swipe (SplashMedia): its HARDWARE KNOBS and its pure
 * math, in stage px (1 stage px = 1 CSS px on the kiosk). No DOM.
 */

/**
 * HARDWARE KNOB. Past this (Euclidean) a press is a drag, never a tap: at or
 * above Chromium's 15 DIP touch slop, so every touch the browser still calls
 * a tap starts the order. Keep it ≥ the kiosk Chrome's --touch-slop-distance.
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
/** HARDWARE KNOB. A step's speed-matched settle, clamped. */
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
 * `p` = the drag in cards (positive toward next), `v` = px/ms (negative =
 * leftward), `travelPx` = the raw |dx|, `engaged` = the slop was crossed
 * sideways. A flick lands on the nearest card in its own direction (a fling
 * back cancels); a slow release steps past SWIPE_COMMIT. One card at most.
 */
export function target(p: number, v: number, travelPx: number, engaged: boolean): -1 | 0 | 1 {
  if (!engaged) return 0;
  const flick = Math.abs(v) >= SWIPE_FLICK_PX_MS && travelPx >= SWIPE_FLICK_MIN_PX;
  const to = flick ? (v < 0 ? Math.ceil(p) : Math.floor(p)) : p >= SWIPE_COMMIT ? 1 : p <= -SWIPE_COMMIT ? -1 : 0;
  return to > 0 ? 1 : to < 0 ? -1 : 0; // also folds Math.ceil's −0
}

/**
 * ViewPager's settle, 4·d/v: --tb-ease-out (cubic-bezier(.2, .8, .2, 1))
 * leaves at 4× its mean speed, so the card leaves at about the finger's.
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

/** The x and the scale of a computed `matrix(a, b, c, d, e, f)`; [0, 1] for anything else (none, jsdom). */
export function matrixOf(transform: string): [x: number, scale: number] {
  const m = /^matrix\(([^)]*)\)$/.exec(transform)?.[1].split(",").map(Number) ?? [];
  return m.length === 6 && m.every(Number.isFinite) ? [m[4], m[0]] : [0, 1];
}
