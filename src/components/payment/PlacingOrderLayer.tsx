import { useTranslation } from "react-i18next";

interface PlacingOrderLayerProps {
  testId: string;
  titleId: string;
}

/**
 * PLACING YOUR ORDER… — the order push's dialog, shared by the two screens
 * that push (usePayAtCounter): /receipt (pay at counter) and /customerName
 * (the zero-bill loyalty order; UX-16 — the house surface on a new screen,
 * for the sign-off list). The /payment buffer's surface WITHOUT the cancel
 * affordance: the push has started and cannot be recalled (brief: "once the
 * push starts, Cancel disappears").
 *
 * It shows at once (it follows a tap and replaces no dialog — never
 * tb-reveal-late): the scrim is still, the card rises (tb-modal-enter on a
 * left-1/2 top-1/2 box with no Tailwind translate), the house sweep
 * (motion-v2 MV3) loops in a card with no button. The owner unmounts it
 * (closing is instant); the z-[60] order-error panel takes over on failure.
 */
export default function PlacingOrderLayer({ testId, titleId }: PlacingOrderLayerProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="absolute inset-0 z-50"
    >
      <div aria-hidden className="absolute inset-0 bg-tb-ink-purple/70" />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 w-[676px] rounded-[12px] bg-tb-surface px-[44px] py-[56px] text-center">
        <h2
          id={titleId}
          className="tb-display text-[40px] leading-[1.1] tracking-[-1px] text-tb-purple"
        >
          {t("payment.placingOrder")}
        </h2>
        {/* The house indeterminate sweep (motion-v2 MV3): no silent wait. */}
        <div aria-hidden className="mx-auto mt-[32px] h-[8px] w-[420px] overflow-hidden rounded-full bg-tb-lilac">
          <div className="tb-indeterminate h-full w-1/3 rounded-full bg-tb-purple" />
        </div>
      </div>
    </div>
  );
}
