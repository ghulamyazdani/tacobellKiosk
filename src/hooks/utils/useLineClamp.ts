import { useEffect, useRef, useState } from "react";

/**
 * Show more / Show less over a line-clamped block (lane offers-parity, first
 * on OfferRow; the PDP description since walk 2026-10-14): `clamped` only
 * when the COLLAPSED block overflows. Measured collapsed only — on resize
 * (the observer's first report included), once the fonts settle and whenever
 * `text` changes (a language switch; "" while the block is not rendered);
 * expanded, the toggle stays. Attach `ref` to the clamped element.
 */
export default function useLineClamp<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || expanded || typeof ResizeObserver === "undefined") return undefined;
    let live = true;
    const measure = () => {
      if (live) setClamped(el.scrollHeight - el.clientHeight > 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts?.ready.then(measure, () => undefined);
    // Named, not an inline `return () => {…}`: guardrails' effect-cleanup scan
    // reads a one-line `return cleanup`.
    const cleanup = () => {
      live = false;
      observer.disconnect();
    };
    return cleanup;
  }, [text, expanded]);
  return { ref, expanded, setExpanded, clamped };
}
