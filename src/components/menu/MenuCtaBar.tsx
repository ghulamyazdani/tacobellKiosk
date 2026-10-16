import { useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { cartQuantity, selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { selectCoupons } from "@cx-sdk/ordering/state/loyalty.slice";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useCartTotal from "../../hooks/cartHooks/useCartTotal";
import { formatPrice } from "../../utils/price";
import { selectAddToCartModal } from "../../redux/features/menuSelections/menuSelections.slice";
import bagIcon from "../../assets/icons/bag.svg";

/** The loyalty layout's count badge on the bag mark (Figma 1:3956). */
const BADGE =
  "absolute -right-[8px] -top-[8px] flex h-[28px] min-w-[28px] items-center justify-center rounded-full bg-tb-pink px-[6px] text-[16px] font-bold leading-none text-tb-purple";

interface MenuCtaBarProps {
  currency: string;
  onViewBag: () => void;
  /**
   * P7c (locked decision 5a) — the loyalty rewards entry. The Menu page owns
   * the branch table and the overlays, so the bar only reports the tap. With
   * the prop omitted — or with loyalty off — the link does not render at all
   * and the bar is byte-identical to P6/P7a/P7b.
   */
  onOpenRewards?: () => void;
}

/**
 * Bottom purple CTA — Figma "CTA": TOTAL left, VIEW MY BAG (n) + bag right.
 * Count = units, the bag header's own `cartQuantity` (it counted rows, so
 * "VIEW MY BAG (4)" opened "MY BAG (5)" — walk 2026-10-14). TOTAL = the
 * bag's own Total, after rewards, taxes and round off (user decision
 * 2026-10-14; it was the pre-tax subtotal: ﷼65.00 over a ﷼34.13 bag): the
 * bag's bill over the live cart as the bag leaves it once it opens — settled,
 * with the offer it applies by itself (useCartTotal) — so it is never 0 or
 * stale before the bag opens. posistKiosk's MenuFooter prints it with
 * moduloCalcaledValue (formatPrice).
 *
 * P7c adds the logged-in variant (Figma menu-rewards 1:3956): the underlined
 * REWARDS / MY REWARDS (n) link takes the left slot and TOTAL stacks over an
 * underlined VIEW MY BAG on the right, with the count badged on the bag mark.
 * That layout is gated on `getIsLoyaltyOn()` (kiosk_settings.enable_loyalty
 * AND a resolved partner — contract trap 9), never on the raw redux flag, so
 * a deployment without loyalty keeps exactly the pre-P7c bar.
 *
 * `cta-total` and `cta-view-bag` keep their ids, their copy (including the
 * "(n)") and their handler in BOTH layouts — the existing suites address them.
 */
export default function MenuCtaBar({
  currency,
  onViewBag,
  onOpenRewards,
}: MenuCtaBarProps) {
  const { t } = useTranslation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped legacy slice
  const cart = useSelector(selectCart) as any;
  const coupons = useSelector(selectCoupons) as unknown[] | null | undefined;
  const { getIsLoyaltyOn } = useAppSettings();

  const itemCount = Number(useSelector(cartQuantity) ?? 0);
  const total = useCartTotal(cart);
  // Re-keys the bag mark so tb-bump replays on every add / remove / re-price
  // (a re-price changes only the total).
  const bagKey = `${itemCount}:${total.toFixed(2)}`;
  // UX-02: the product-added modal's scrim covers this bar, so while it is
  // up the mark and the badge are still nodes, and its close re-keys both:
  // the bump and the pop play as the guest looks back (ADD TO ORDER adds and
  // closes in one commit: one bump). The bar the menu mounts with stays
  // still (PDP BACK, a reload): each arms at its first change, or a close.
  // Adjusting state while rendering (DetourTapGuard's pattern).
  const covered = Boolean(useSelector(selectAddToCartModal));
  const [seen, setSeen] = useState({ bagKey, itemCount, covered, bump: false, pop: false });
  if (seen.bagKey !== bagKey || seen.covered !== covered) {
    const closed = seen.covered && !covered;
    setSeen({
      bagKey,
      itemCount,
      covered,
      bump: seen.bump || closed || seen.bagKey !== bagKey,
      pop: seen.pop || closed || seen.itemCount !== itemCount,
    });
  }
  const mark = covered ? (
    <img key="covered" alt="" src={bagIcon} className="h-[50px] w-[50px]" />
  ) : (
    <img key={bagKey} alt="" src={bagIcon} className={seen.bump ? "tb-bump h-[50px] w-[50px]" : "h-[50px] w-[50px]"} />
  );

  // Label per the brief: REWARDS until the lookup has returned a coupon list,
  // MY REWARDS (n) once it has.
  const rewardsCount = coupons?.length ?? 0;
  const showRewardsLink = Boolean(onOpenRewards) && Boolean(getIsLoyaltyOn());

  const totalLine = (
    <p
      className="tb-display text-[24px] leading-[32px] text-tb-surface"
      data-testid="cta-total"
    >
      {t("menu.total")}: {currency}
      {formatPrice(total)}
    </p>
  );

  if (!showRewardsLink) {
    return (
      <div className="flex w-full items-center justify-between bg-tb-purple p-[48px] drop-shadow-[0px_0px_32px_rgba(0,0,0,0.08)]">
        {totalLine}
        <button
          type="button"
          data-testid="cta-view-bag"
          onClick={onViewBag}
          className="flex min-h-[44px] items-center gap-[24px]"
        >
          <span className="tb-display text-[24px] leading-[32px] text-tb-surface">
            {t("menu.viewMyBag")} ({itemCount})
          </span>
          {mark}
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center justify-between bg-tb-purple p-[48px] drop-shadow-[0px_0px_32px_rgba(0,0,0,0.08)]">
      <button
        type="button"
        data-testid="menu-rewards-link"
        onClick={onOpenRewards}
        className="tb-display flex min-h-[44px] items-center text-[20px] leading-[24px] text-tb-surface underline underline-offset-[6px]"
      >
        {rewardsCount > 0
          ? t("loyalty.myRewards", { count: rewardsCount })
          : t("loyalty.rewardsLink")}
      </button>

      <div className="flex items-center gap-[24px]">
        <div className="flex flex-col items-end gap-[8px]">
          {totalLine}
          <button
            type="button"
            data-testid="cta-view-bag"
            onClick={onViewBag}
            className="flex min-h-[44px] items-center"
          >
            <span className="tb-display text-[20px] leading-[24px] text-tb-surface underline underline-offset-[6px]">
              {t("menu.viewMyBag")} ({itemCount})
            </span>
          </button>
        </div>
        {/* Figma 1:3956 badges the count on the bag mark. The badge is
            tb-purple on tb-pink (4.57:1 — WCAG AA); white on tb-pink is
            2.46:1 and would fail Rule 4. */}
        <button
          type="button"
          aria-label={t("menu.viewMyBag")}
          onClick={onViewBag}
          className="relative flex h-[50px] min-h-[44px] w-[50px] min-w-[44px] items-center justify-center"
        >
          {mark}
          {itemCount > 0 && (
            <span
              key={covered ? "covered-badge" : itemCount}
              aria-hidden="true"
              className={seen.pop && !covered ? `tb-pop-in ${BADGE}` : BADGE}
            >
              {itemCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
