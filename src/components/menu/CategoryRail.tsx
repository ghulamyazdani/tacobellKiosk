import type { ReactNode } from "react";
import tbBell from "../../assets/brand/tb-bell.svg";

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
}

/**
 * Left category rail — Figma "Menu-Categories" (264px, white, bell on top,
 * compressed-bold rows, selected = vibrant purple pill). Rows pad 24 / 12:
 * "CRAVINGS MENU" (174.3 px) needs the 179 px box; labels stay left-aligned.
 * Only the category list scrolls; the bell and the slot above it stay put.
 */
export default function CategoryRail({
  categories,
  selectedId,
  onSelect,
  children,
}: CategoryRailProps) {
  return (
    <nav
      data-testid="category-rail"
      className="flex h-full w-[264px] shrink-0 flex-col items-center border-r border-tb-grey-4 bg-tb-surface px-[24px] pt-[40px]"
    >
      <img alt="Taco Bell" src={tbBell} className="mb-[40px] h-[64px] w-[72px] brightness-0" />
      {children}
      <div className="flex w-full flex-col overflow-y-auto">
        {categories.map((category) => {
          const selected = category.id === selectedId;
          return (
            <button
              key={category.id}
              type="button"
              data-testid={`rail-${category.id}`}
              onClick={() => onSelect(category.id)}
              className={`tb-compressed h-[64px] w-full shrink-0 rounded-[8px] pl-[24px] pr-[12px] text-left text-[30px] leading-[24px] min-h-[44px] ${
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
