import { useState } from "react";
import { NavigationType, useLocation, useNavigationType } from "react-router-dom";

/** The page-content entrance a page root carries as `data-enter`. */
export type PageEnter = "fwd" | "back" | undefined;

/**
 * Screens visited this session, oldest first. Module scope (one router per
 * kiosk). AppRoutes writes it AFTER each committed pathname, so a page's
 * first render still sees the screen being left at the end.
 */
let trail: string[] = [];

/**
 * AppRoutes, once per committed pathname. The splash and Order Complete start
 * a new, EMPTY trail. Order Complete's one exit is the splash today, so its
 * reset is harmless belt and braces: should an exit ever skip /start again,
 * a trail that kept /orderSuccess would read the next customer's Order
 * Complete as a return ("back").
 */
export function notePath(path: string): void {
  if (path === "/start" || path === "/orderSuccess") {
    trail = [];
    return;
  }
  const at = trail.lastIndexOf(path);
  trail = at >= 0 ? trail.slice(0, at + 1) : [...trail, path];
}

/**
 * POP is a page load (reload, crash recovery, PWA update): never animates.
 * A PUSH is "back" to a screen already on the trail, else "fwd". A REPLACE is
 * a guard / redirect / resume and stays still — EXCEPT a return to the screen
 * just before the one being left: the PDP's close (BACK, ADD TO BAG) lands as
 * a REPLACE, because its no-session guard re-navigates when the session close
 * renders ahead of the router transition.
 */
export function pageEnterDirection(
  path: string,
  navType: NavigationType,
  visited: readonly string[] = trail,
): PageEnter {
  if (navType === NavigationType.Pop) return undefined;
  // A page mounting after its own commit (a lazy screen) already sees itself last.
  const before = visited[visited.length - 1] === path ? visited.slice(0, -1) : visited;
  if (navType === NavigationType.Replace) return before.at(-2) === path ? "back" : undefined;
  return before.includes(path) ? "back" : "fwd";
}

/**
 * `data-enter={usePageEnter()}` on a page ROOT (motion contract §2.2).
 * Latched at mount: the value never changes for the page's life — a later
 * change would START the entrance on a live page. `quiet` (read once) skips
 * it, e.g. Menu mounting under an open overlay.
 */
export default function usePageEnter(quiet = false): PageEnter {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const [enter] = useState<PageEnter>(() =>
    quiet ? undefined : pageEnterDirection(pathname, navType),
  );
  return enter;
}
