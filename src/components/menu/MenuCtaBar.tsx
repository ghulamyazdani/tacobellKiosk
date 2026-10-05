import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { selectCoupons } from "@cx-sdk/ordering/state/loyalty.slice";
import useAppSettings from "../../hooks/utils/useAppSettings";
import bagIcon from "../../assets/icons/bag.svg";

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
 * Count = cart rows; total = the slice's live subTotal (recomputed by the
 * add/increment reducers). The full bill (charges/offers) renders on the
 * cart page via the bill engine in P7.
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

  const itemCount: number = cart?.cartItems?.length ?? 0;
  const netAmount = cart?.subTotal ?? 0;

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
      {Number(netAmount).toFixed(2)}
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
          <img alt="" src={bagIcon} className="h-[50px] w-[50px]" />
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
          <img alt="" src={bagIcon} className="h-[50px] w-[50px]" />
          {itemCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-[8px] -top-[8px] flex h-[28px] min-w-[28px] items-center justify-center rounded-full bg-tb-pink px-[6px] text-[16px] font-bold leading-none text-tb-purple"
            >
              {itemCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
