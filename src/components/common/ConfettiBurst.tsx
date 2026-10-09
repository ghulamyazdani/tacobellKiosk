import type { CSSProperties } from "react";

const CONFETTI_COLOURS = [
  "bg-tb-yellow",
  "bg-tb-pink",
  "bg-tb-purple-vibrant",
  "bg-tb-pink-dark",
  "bg-tb-lilac",
] as const;

/**
 * 28 pieces, computed ONCE at module load (never Math.random in render —
 * react-hooks/purity): golden-angle directions spread them evenly, a +160px
 * drop biases the burst downward, and a staggered --d keeps it from reading
 * as one flat ring. Motion is the .tb-confetti-piece CSS (index.css).
 */
const CONFETTI = Array.from({ length: 28 }, (_, i) => {
  const angle = i * 2.39996;
  const reach = 200 + ((i * 47) % 160);
  return {
    colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
    style: {
      "--tx": `${Math.round(Math.cos(angle) * reach * 1.3)}px`,
      "--ty": `${Math.round(Math.sin(angle) * reach * 0.5 + 160)}px`,
      "--r": `${((i * 97) % 540) - 270}deg`,
      "--d": `${(i % 4) * 60}ms`,
    } as CSSProperties,
  };
});

/**
 * One CSS confetti burst from the centre of its POSITIONED parent (lane
 * offers item 33; shared since lane motion by the offer celebration and
 * Order Complete). Plays once on mount, ends invisible, hidden under reduced
 * motion. pointer-events-none: the invisible end-state pieces never take a tap.
 */
export default function ConfettiBurst() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {CONFETTI.map(({ colour, style }, index) => (
        <span key={index} className={`tb-confetti-piece ${colour}`} style={style} />
      ))}
    </span>
  );
}
