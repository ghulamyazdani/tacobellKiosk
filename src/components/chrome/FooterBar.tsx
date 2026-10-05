import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { toggleAccessibilityMode } from "@cx-sdk/catalog/state/appSettings.slice";
import { selectSelectedLanguage } from "../../redux/features/multiLanguage/multiLanguage.slice";
import adaIcon from "../../assets/icons/ada.svg";
import chevronUp from "../../assets/icons/chevron-up.svg";
import gbFlag from "../../assets/flags/gb.svg";

interface FooterBarProps {
  onCancelOrder?: () => void;
  onOpenLanguage: () => void;
}

/**
 * Persistent bottom bar — Figma "Footer bottom" (light purple, 56px):
 * CANCEL ORDER · ADA DISPLAY · language selector. The ADA toggle dispatches
 * the SDK's accessibility flag today; the scale-transform view lands in P9.
 */
export default function FooterBar({
  onCancelOrder,
  onOpenLanguage,
}: FooterBarProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const selectedLanguage = useSelector(selectSelectedLanguage);

  return (
    <div className="absolute bottom-0 left-0 flex h-[56px] w-[1080px] items-center justify-between bg-tb-purple-vibrant px-[10px]">
      {onCancelOrder ? (
        <button
          type="button"
          data-testid="footer-cancel"
          onClick={onCancelOrder}
          className="flex h-full min-h-[44px] min-w-[44px] items-center rounded-[8px] px-[24px]"
        >
          <span className="tb-display text-[16px] leading-[16px] font-medium text-tb-surface">
            {t("footer.cancelOrder")}
          </span>
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-[24px]">
        <button
          type="button"
          data-testid="footer-ada"
          onClick={() => dispatch(toggleAccessibilityMode())}
          className="flex h-[56px] min-w-[44px] items-center gap-[8px] rounded-[8px] px-[12px]"
        >
          <img alt="" src={adaIcon} className="h-[32px] w-[32px]" />
          <span className="tb-display text-[16px] leading-[16px] font-medium text-tb-surface">
            {t("footer.adaDisplay")}
          </span>
        </button>
        <button
          type="button"
          data-testid="footer-language"
          onClick={onOpenLanguage}
          className="flex h-[56px] min-w-[44px] items-center gap-[8px] rounded-[8px] px-[12px]"
        >
          <span className="h-[32px] w-[32px] overflow-hidden rounded-full">
            <img alt="" src={gbFlag} className="h-full w-full object-cover" />
          </span>
          <span className="tb-display text-[16px] leading-[16px] font-medium text-tb-surface">
            {selectedLanguage?.name ?? t("language.english")}
          </span>
          <img alt="" src={chevronUp} className="h-[24px] w-[24px]" />
        </button>
      </div>
    </div>
  );
}
