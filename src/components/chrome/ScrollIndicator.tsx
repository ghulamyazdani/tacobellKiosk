import { useEffect, useRef, type RefObject } from "react";

/** Floor so a long menu never shrinks the thumb to a sliver. */
const MIN_THUMB_PX = 40;
/** Sub-pixel rounding leaves ~1 px of "overflow" on content that fits (fork ScrollRail). */
const OVERFLOW_EPSILON = 2;

/**
 * Figma "Scroll bar" (1:5263): 11 px lilac track, purple thumb, both r2, over
 * the right padding of a vertical scroll pane whose native bar is hidden.
 * INDICATOR ONLY (contract D3): aria-hidden + pointer-events-none, so the
 * native touch scroll stays the one gesture (no 44 px target, no conflict).
 *
 * NO React state (fork ScrollRail): visibility, size and position are DOM
 * writes through refs — zero renders per scroll. The track stays mounted while
 * `invisible` so both refs exist before the first overflow, and React never
 * rewrites the inline visibility it did not set.
 *
 * Content changes (late menu load, PDP groups, a size pick, show more): a
 * ResizeObserver on the pane AND each direct child, plus a childList-only
 * MutationObserver on the pane that observes children as they come and go.
 */
export default function ScrollIndicator({
  target,
  top,
  height,
  testId,
}: {
  target: RefObject<HTMLElement | null>;
  top: number;
  height: number;
  testId: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const paint = () => {
      const tr = track.current;
      const th = thumb.current;
      if (!tr || !th) return;
      const overflow = el.scrollHeight - el.clientHeight;
      tr.style.visibility = overflow > OVERFLOW_EPSILON ? "visible" : ""; // "" = the `invisible` class
      if (overflow <= OVERFLOW_EPSILON) return;
      const h = Math.min(
        height,
        Math.max(MIN_THUMB_PX, Math.round((height * el.clientHeight) / el.scrollHeight))
      );
      th.style.height = `${h}px`;
      th.style.transform = `translateY(${Math.round((el.scrollTop / overflow) * (height - h))}px)`;
    };
    paint();
    el.addEventListener("scroll", paint, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(paint);
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    const mo =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver((records) => {
            for (const record of records) {
              for (const n of Array.from(record.addedNodes)) {
                if (n instanceof Element) ro?.observe(n);
              }
              // Unobserve leavers so a long-lived pane never pins detached nodes.
              for (const n of Array.from(record.removedNodes)) {
                if (n instanceof Element) ro?.unobserve(n);
              }
            }
            paint();
          });
    mo?.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", paint);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [target, height]);

  return (
    <div
      ref={track}
      aria-hidden
      data-testid={testId}
      className="pointer-events-none invisible absolute right-[12px] w-[11px] rounded-[2px] bg-tb-lilac"
      style={{ top, height }}
    >
      {/* Inline transform only — never a Tailwind translate-* here: those use
          the CSS `translate` property and STACK with it (PROGRESS notes). */}
      <div ref={thumb} data-testid={`${testId}-thumb`} className="w-full rounded-[2px] bg-tb-purple" />
    </div>
  );
}
