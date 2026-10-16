import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
// Figma's rail bell (Menu-Categories "Bell", 1:24 — Dark Purple with the Grey 6
// cut-out), exported as is (user 2026-10-13: the rail showed the white bell
// filtered to black). ?no-inline: a precached file, never boot-path bytes.
import tbBellRail from "../../assets/brand/tb-bell-rail.svg?no-inline";
import { scrollBehavior } from "../../utils/autoScroll";

/**
 * The selected row to the list's middle when the list's box hides it — by
 * the list's own scroll (scrollIntoView would scroll the clipped ancestors
 * too). Instant unless `behavior` says otherwise.
 */
function revealSelected(list: HTMLElement, behavior?: ScrollBehavior) {
  const row = list.querySelector<HTMLElement>('[aria-current="true"]');
  if (!row) return;
  const { offsetTop: top, offsetHeight: height } = row;
  if (top >= list.scrollTop && top + height <= list.scrollTop + list.clientHeight) return;
  const target = top - (list.clientHeight - height) / 2;
  if (behavior) list.scrollTo({ top: target, behavior });
  else list.scrollTop = target;
}

export interface RailCategory {
  id: string;
  name: string;
}

interface CategoryRailProps {
  categories: RailCategory[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Rendered between the bell and the list (the menu's diet filter chips). */
  children?: ReactNode;
  /**
   * Set by the rail: the menu's scroll spy marks the row in view through it,
   * re-rendering the rail alone (never the menu, never its grid).
   */
  spyRef?: RefObject<((id: string) => void) | null>;
}

/**
 * Left category rail — Figma "Menu-Categories" (264px, white, bell on top,
 * compressed-bold rows, selected = vibrant purple pill). Rows pad 24 / 12:
 * "CRAVINGS MENU" (174.3 px) needs the 179 px box; labels stay left-aligned.
 * A row is at least 64 px with 8 px insets: one or two lines (30/24) keep
 * Figma's 64 px pill, a longer name grows the row 24 px a line, and a word
 * wider than the box breaks inside it (rail-wrap, user report 2026-10-14 —
 * the frames draw only short labels: design language, sign-off).
 * Only the category list scrolls; the bell and the slot above it stay put.
 * The selected fill swaps instantly (Figma); `aria-current` drives the
 * tb-select bump (motion lane, design language).
 * A selected row the list's box hides comes to its middle (revealSelected):
 * at once at mount (one at a time keeps the selection through the PDP) and
 * whenever the box changes — the ADA toggle shrinks it with no remount —, and
 * smoothly (instant under reduced motion) when the selection moves on its own:
 * the menu's scroll spy. A tap moves nothing: its row is on screen.
 * A spied row (spyRef) stands over `selectedId` until that changes (a tap, a
 * filter, a refetch) or a row is tapped; one the rail no longer lists drops.
 */
export default function CategoryRail({
  categories,
  selectedId,
  onSelect,
  children,
  spyRef,
}: CategoryRailProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [spied, setSpied] = useState<{ id: string; over: string } | null>(null);
  const selectedRef = useRef(selectedId);
  useLayoutEffect(() => {
    selectedRef.current = selectedId;
  });
  useLayoutEffect(() => {
    if (!spyRef) return;
    // The same row over the same selection keeps the state: the spy calls on
    // every scroll event, and a bail-out never re-renders.
    spyRef.current = (id) =>
      setSpied((prev) =>
        prev?.id === id && prev.over === selectedRef.current ? prev : { id, over: selectedRef.current }
      );
    return () => {
      spyRef.current = null;
    };
  }, [spyRef]);
  const shownId =
    spied && spied.over === selectedId && categories.some((category) => category.id === spied.id)
      ? spied.id
      : selectedId;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reveal = () => revealSelected(list);
    reveal();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(reveal);
    observer?.observe(list);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    if (listRef.current) revealSelected(listRef.current, scrollBehavior());
  }, [shownId]);
  return (
    <nav
      data-testid="category-rail"
      className="flex h-full w-[264px] shrink-0 flex-col items-center border-r border-tb-grey-4 bg-tb-surface px-[24px] pt-[40px]"
    >
      <img alt="Taco Bell" src={tbBellRail} className="mb-[40px] h-[64px] w-[72px]" />
      {children}
      {/* The list scrolls by touch with no native scrollbar (user 2026-10-14:
          "there is a scrollbar in the sidebar"), like the menu pane.
          bg-transparent: un-composited like the pane (pages/Menu, perf
          PAINT-1 opt-out) — painted before the menu photos' blend, a
          composited list would split them into their own layers too. */}
      <div
        ref={listRef}
        // relative: the rows' offsetTop is measured from this list.
        className="relative flex w-full flex-col overflow-y-auto bg-transparent [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {categories.map((category) => {
          const selected = category.id === shownId;
          return (
            <button
              key={category.id}
              type="button"
              data-testid={`rail-${category.id}`}
              aria-current={selected ? "true" : undefined}
              onClick={() => {
                setSpied(null);
                onSelect(category.id);
              }}
              className={`tb-select tb-compressed min-h-[64px] w-full shrink-0 rounded-[8px] py-[8px] pl-[24px] pr-[12px] text-left text-[30px] leading-[24px] [overflow-wrap:anywhere] ${
                selected ? "bg-tb-purple-vibrant text-tb-surface" : "text-tb-purple"
              }`}
            >
              {category.name}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
