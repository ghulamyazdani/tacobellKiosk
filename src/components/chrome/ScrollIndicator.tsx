import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** Floor so a long menu never shrinks the thumb to a sliver. */
const MIN_THUMB_PX = 40;
/** Sub-pixel rounding leaves ~1 px of "overflow" on content that fits (fork ScrollRail). */
const OVERFLOW_EPSILON = 2;

/**
 * Figma "Scroll bar" (1:5263): 11 px lilac track, purple thumb, both r2, over
 * the right padding of a vertical scroll pane whose native bar is hidden.
 *
 * DRAGGABLE (user request 2026-10-08, reversing D3's indicator-only bar): hold
 * the bar and drag to scroll fast — a vertical port of the fork's ScrollRail.
 * A press on the thumb grabs it where it lands; a press anywhere else on the
 * bar jumps the thumb's centre under the finger (the fork's jumpTo, but
 * instant) and the same press keeps dragging. Direct manipulation only: plain
 * scrollTop writes, no smooth scroll, no rAF, no timers. The pane's native
 * touch scroll is untouched. Screen readers keep that native scroll, so both
 * nodes are aria-hidden with no role, no tab stop and no label.
 *
 * TWO SIBLINGS, not a wrapper: the track below is byte-for-byte the old
 * indicator (aria-hidden, pointer-events-none) because the three pages, their
 * unit tests and menu-scroll.spec pin that node — its parent is the page root,
 * its previous sibling #scrollCustomizableItem, its inline top/height, its
 * 11 px box. The gesture lives on a transparent HIT STRIP rendered after it.
 *
 * WHY THE STRIP IS 24 px, NOT 44 px (Rule 4 deviation, client sign-off). Stage
 * px, the same in EN, AR (the layout stays LTR) and ADA (only heights change):
 * content ends at x 1056 at every site (panes px-24 / p-24) — the menu card's
 * open overlay (its 44 px quick-add 1000–1044), the PDP title Counter's +
 * (992–1056), the OptionRow pill (its + ≈1000–1044; option and slot grids end
 * at 1040; You Might Like clips at 1056), the tier-2 Counter and rows. The
 * track is x 1057–1068, so the free gutter is x 1056–1080 = 24 px. A 44 px
 * strip (1036–1080) would cover 20 px of those controls, steal their taps,
 * and its touch-action: none would stop native pans that start on them.
 * 24 px meets WCAG 2.5.8 (AA) and the strip is 394–790 px tall. Inside the
 * bar's y-range a swipe that starts in the gutter now drives the bar instead
 * of panning the pane 1:1.
 *
 * TOUCH ADJUSTMENT: Chromium moves a fat-finger touch onto the nearest node
 * that "responds to taps" — a click or mouse* listener ON the node (pointer*
 * listeners do not count), focusable, or styled by :active/:hover. React
 * delegates every handler to the root, so the bare strip is no such node and
 * a finger on the visible bar went to the card / Counter + ending at x 1056:
 * a tap opened or added the item, a drag did nothing (review 2026-10-08). The
 * strip's `active:opacity-100` draws nothing (opacity 1 is the default and
 * makes no stacking context) but makes it a tap target, like the fork thumb's
 * `active:` colour. A touch on the strip now stays there; content taps stay
 * with the content (only a point ≤ 1 px inside it, at a ≥ 15 px radius, moves).
 *
 * NO preventDefault() / stopPropagation() on pointerdown (the fork does both).
 * IdleGuard's react-idle-timer listens on document (capture, passive) to
 * mousedown/mousemove/touchstart/touchmove…, never to pointer events, and a
 * cancelled pointerdown suppresses the compat mouse events: a mouse drag would
 * stop counting as guest activity. Touch events always fire. Text selection
 * is already off (body user-select: none) and App blocks contextmenu.
 *
 * NO React state (fork ScrollRail): visibility, size, position and the drag
 * are DOM writes through refs — zero renders per scroll or drag move. Drag
 * geometry is read live on every event in client px (getBoundingClientRect
 * folds in KioskStage's transform: scale). Pointer capture routes the moves
 * to the strip, so there are no document/window listeners; React drops the
 * handlers on unmount. Both nodes stay mounted while `invisible` so the refs
 * exist before the first overflow, and React never rewrites the inline
 * visibility it did not set; the strip follows the track's visibility, so a
 * pane that fits has no hit zone.
 *
 * Content changes (late menu load, PDP groups, a size pick, show more): a
 * ResizeObserver on the pane AND each direct child, plus a childList-only
 * MutationObserver on the pane that observes children as they come and go.
 *
 * HELD (user request 2026-10-16; design language, client sign-off): while a
 * drag owns the bar the thumb carries [data-held] and eases 1.5× wider; the
 * drag's end (up, cancel or a lost capture, wherever the finger lifts:
 * capture routes it here) removes it and the thumb eases back. Pure CSS: the
 * `scale` property, X only. It composes with the inline translateY without
 * moving the thumb (a Y scale would scale that offset too, and the height
 * the drag reads). Reduced motion: the global block makes it instant.
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
  const hit = useRef<HTMLDivElement>(null);
  /**
   * The pointer that owns the drag, where on the thumb it holds it (client px
   * from the thumb's top), and the finger y / scrollTop / overflow as of its
   * last event.
   */
  const drag = useRef<{ id: number; grab: number; y: number; at: number; overflow: number } | null>(null);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const paint = () => {
      const tr = track.current;
      const th = thumb.current;
      const strip = hit.current;
      if (!tr || !th || !strip) return;
      const overflow = el.scrollHeight - el.clientHeight;
      const visibility = overflow > OVERFLOW_EPSILON ? "visible" : ""; // "" = the `invisible` class
      tr.style.visibility = visibility;
      strip.style.visibility = visibility;
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

  /** Live drag geometry in client px; null = nothing to drag (no refs, the pane fits, or no travel). */
  const geometry = () => {
    const el = target.current;
    const tr = track.current;
    const th = thumb.current;
    if (!el || !tr || !th) return null;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow <= OVERFLOW_EPSILON) return null;
    const r = tr.getBoundingClientRect();
    const thumbH = th.getBoundingClientRect().height;
    const travel = r.height - thumbH;
    if (travel <= 0) return null;
    return { el, overflow, trackTop: r.top, thumbH, travel };
  };

  /**
   * Puts the held point of the thumb under the finger (absolute, clamped).
   * If something else moved the pane since the last event — a rail tap's or
   * the PDP's smooth scroll still running (a press does not stop it), a
   * fling's last frame, content that grew — the grab re-bases first, so the
   * drag carries on from where the pane is instead of snapping back (native
   * scroll bars do the same).
   */
  const follow = (clientY: number) => {
    const g = geometry();
    const d = drag.current;
    if (!d) return;
    if (!g) {
      // The pane fits for now: track the finger anyway, so a regrow re-bases
      // from where it IS — its moves while nothing could scroll are not replayed.
      d.y = clientY;
      return;
    }
    if (Math.abs(g.el.scrollTop - d.at) > 1 || g.overflow !== d.overflow) {
      d.grab = d.y - (g.trackTop + (g.el.scrollTop / g.overflow) * g.travel);
    }
    g.el.scrollTop = Math.min(1, Math.max(0, (clientY - g.trackTop - d.grab) / g.travel)) * g.overflow;
    d.y = clientY;
    d.at = g.el.scrollTop;
    d.overflow = g.overflow;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) return; // the first pointer owns the drag
    const g = geometry();
    if (!g) return;
    const thumbTop = g.trackTop + (g.el.scrollTop / g.overflow) * g.travel;
    const onThumb = e.clientY >= thumbTop && e.clientY <= thumbTop + g.thumbH;
    drag.current = {
      id: e.pointerId,
      grab: onThumb ? e.clientY - thumbTop : g.thumbH / 2,
      y: e.clientY,
      at: g.el.scrollTop,
      overflow: g.overflow,
    };
    thumb.current?.setAttribute("data-held", "");
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // An inactive or synthetic pointer (jsdom has no setPointerCapture):
      // the moves that still reach the strip keep driving the drag.
    }
    if (!onThumb) follow(e.clientY); // the jump; the same press drags on from there
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) follow(e.clientY);
  };

  // Up, cancel or a lost capture: the browser releases the capture itself.
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    thumb.current?.removeAttribute("data-held");
  };

  return (
    <>
      <div
        ref={track}
        aria-hidden
        data-testid={testId}
        className="pointer-events-none invisible absolute right-[12px] w-[11px] rounded-[2px] bg-tb-lilac"
        style={{ top, height }}
      >
        {/* Inline transform only — never a Tailwind translate-* here: those use
            the CSS `translate` property and STACK with it (PROGRESS notes).
            The held widening stacks on purpose: `scale`, X only (header). */}
        <div
          ref={thumb}
          data-testid={`${testId}-thumb`}
          className="w-full rounded-[2px] bg-tb-purple transition-[scale] duration-(--tb-dur-pop) ease-(--tb-ease-out) data-held:scale-x-150"
        />
      </div>
      {/* The hit strip: transparent, the pane's whole 24 px right gutter over
          the bar's y-range (header). touch-none lets a finger drag it;
          active:opacity-100 draws nothing but makes it a Blink tap target, so
          touch adjustment keeps a finger on the bar (header). */}
      <div
        ref={hit}
        aria-hidden
        data-testid={`${testId}-hit`}
        className="invisible absolute right-0 w-[24px] touch-none active:opacity-100"
        style={{ top, height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
      />
    </>
  );
}
