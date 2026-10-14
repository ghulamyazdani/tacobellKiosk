/**
 * An item photo's band when the item has none (walk 2026-10-14: imageless
 * items showed bare grey bands that read as failed loads): a faint Taco Bell
 * bell centred on the grey — `.tb-no-image-bell` (index.css), tb-purple at
 * 25 % like the reward plates' bell. Design language, no frame — client
 * sign-off. Every image surface renders it in place of its <img> ONLY when
 * resolveEntityImage found no photo, so it never shows under, or while
 * loading, a real one. `className` sizes and places the box the photo would
 * fill (it needs a definite height).
 */
export default function NoImageBell({ className = "h-full w-full" }: { className?: string }) {
  return (
    <span aria-hidden="true" data-testid="no-image-bell" className={`block ${className}`}>
      <span className="tb-no-image-bell block h-full w-full" />
    </span>
  );
}
