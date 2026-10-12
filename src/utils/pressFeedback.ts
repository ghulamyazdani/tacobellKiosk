/**
 * Touch-down press STATE (motion-v2 MV1). Chromium applies :active to a touch
 * only at GestureShowPress (~150 ms held; on a quick tap, just AFTER the
 * click), so Figma's pressed fills lagged the finger. This mirrors a touch
 * press as `[data-pressed]` on the button at touch-down; index.css's
 * `active` variant and the three pressed fills answer it. Not motion: no
 * animation API, nothing waits on it, and the .97 squeeze stays on :active.
 * Mouse input is ignored (its :active is already instant).
 */
const SCROLLER = ".overflow-y-auto, .overflow-x-auto"; // every scroller class in src (no overflow-auto / -scroll)
// ponytail: Android's prepressed delay (TAP_TIMEOUT 100 ms), only where a pan can start,
// so a pan's first frames never flash a fill; tune on the panel.
export const PREPRESS_MS = 90;

/** True when a scroller around `el` overflows: a touch there may become a pan. */
function canPan(el: Element): boolean {
  for (let sc = el.closest(SCROLLER); sc; sc = sc.parentElement?.closest(SCROLLER) ?? null) {
    if (sc.scrollHeight > sc.clientHeight || sc.scrollWidth > sc.clientWidth) return true;
  }
  return false;
}

/** Installs the document-level listeners once (main.tsx); returns the uninstall. */
export function installPressFeedback(doc: Document = document): () => void {
  let held: Element | null = null;
  let heldId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
    held?.removeAttribute("data-pressed");
    held = null;
    heldId = null;
  };
  const press = (event: PointerEvent) => {
    // A mouse's :active is already instant; a second finger never steals or ends the press.
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    clear();
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.matches(":disabled, [aria-disabled='true']")) return;
    held = button;
    heldId = event.pointerId;
    if (canPan(button)) timer = setTimeout(() => button.setAttribute("data-pressed", ""), PREPRESS_MS);
    else button.setAttribute("data-pressed", "");
  };
  const release = (event: PointerEvent) => {
    if (event.pointerId === heldId) clear();
  };
  const listeners = [
    ["pointerdown", press],
    ["pointerup", release],
    ["pointercancel", release], // a pan hands the touch to scrolling; sliding off a button cancels too
  ] as const;
  const opts = { capture: true, passive: true } as const;
  for (const [type, fn] of listeners) doc.addEventListener(type, fn, opts);
  return () => {
    clear();
    for (const [type, fn] of listeners) doc.removeEventListener(type, fn, opts);
  };
}
