import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  selectEnableAccessbilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectSelectedLanguage } from "../../redux/features/multiLanguage/multiLanguage.slice";
import useAdaActive from "../../hooks/utils/useAdaActive";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import chevronUp from "../../assets/icons/chevron-up.svg";
import gbFlag from "../../assets/flags/gb.svg";

interface FooterBarProps {
  onCancelOrder?: () => void;
  onOpenLanguage: () => void;
}

/**
 * Persistent bottom bar — Figma "Footer bottom" (light purple, 56px):
 * CANCEL ORDER · ADA DISPLAY · language selector. The ADA toggle flips the
 * SDK's accessibility flag, which ReachZone renders as the reach-zone view;
 * it is hidden while the tenant has the feature off (fork parity). Its
 * on-state — which Figma does not draw — is `aria-pressed` and, since the walk
 * of 2026-10-14 (it looked the same both ways), the bag order-type pill's
 * white fill with a purple label and glyph (design language, sign-off).
 */
export default function FooterBar({
  onCancelOrder,
  onOpenLanguage,
}: FooterBarProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const selectedLanguage = useSelector(selectSelectedLanguage);
  const adaEnabled = Boolean(useSelector(selectEnableAccessbilityMode));
  const adaActive = useAdaActive();

  return (
    <div className="absolute bottom-0 left-0 flex h-[56px] w-[1080px] items-center justify-between bg-tb-purple-vibrant px-[10px]">
      {onCancelOrder ? (
        <button
          type="button"
          data-testid="footer-cancel"
          onClick={() => {
            captureKioskEvent(KioskEventName.StartOverClickedFromFooter, {
              route_path: window.location.pathname,
            });
            onCancelOrder();
          }}
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
        {adaEnabled && (
          <button
            type="button"
            data-testid="footer-ada"
            aria-pressed={adaActive}
            onClick={() => dispatch(toggleAccessibilityMode())}
            className={`flex h-[56px] min-w-[44px] items-center gap-[8px] rounded-[8px] px-[12px] ${
              adaActive ? "bg-tb-surface text-tb-purple" : "text-tb-surface"
            }`}
          >
            {/* Figma's glyph (1:2587 Icons/content), inline so it takes the
                label's colour in both states. */}
            <svg aria-hidden="true" viewBox="0 0 32 32" className="h-[32px] w-[32px] fill-current">
              <path d="M16 8.8C17.2624 8.8 18.2857 7.72548 18.2857 6.4C18.2857 5.07452 17.2624 4 16 4C14.7376 4 13.7143 5.07452 13.7143 6.4C13.7143 7.72548 14.7376 8.8 16 8.8Z" />
              <path d="M24 17.2V14.8C22.24 14.824 20.4686 13.9 19.3486 12.604L17.8743 10.888C17.68 10.66 17.44 10.48 17.1771 10.348C17.1657 10.348 17.1657 10.336 17.1543 10.336H17.1429C16.7429 10.096 16.2857 9.976 15.7829 10.024C14.5829 10.132 13.7143 11.248 13.7143 12.508V19.6C13.7143 20.92 14.7429 22 16 22H21.7143V28H24V21.4C24 20.08 22.9714 19 21.7143 19H18.2857V14.86C19.76 16.144 22 17.188 24 17.2ZM13.7143 25.6C11.8171 25.6 10.2857 23.992 10.2857 22C10.2857 20.428 11.2457 19.108 12.5714 18.604V16.12C9.96571 16.672 8 19.096 8 22C8 25.312 10.56 28 13.7143 28C16.48 28 18.7886 25.936 19.3143 23.2H16.9486C16.48 24.592 15.2114 25.6 13.7143 25.6Z" />
            </svg>
            <span className="tb-display text-[16px] leading-[16px] font-medium">
              {t("footer.adaDisplay")}
            </span>
          </button>
        )}
        <button
          type="button"
          data-testid="footer-language"
          onClick={onOpenLanguage}
          className="flex h-[56px] min-w-[44px] items-center gap-[8px] rounded-[8px] px-[12px]"
        >
          <span className="h-[32px] w-[32px] overflow-hidden rounded-full">
            <img alt="" src={gbFlag} className="h-full w-full object-cover" />
          </span>
          {/* dir="auto": the language's own name (العربية) reads rtl in an ltr layout. */}
          <span dir="auto" className="tb-display text-[16px] leading-[16px] font-medium text-tb-surface">
            {/* || not ??: a session reset stores name "" (a blank label) */}
            {selectedLanguage?.name || t("language.english")}
          </span>
          <img alt="" src={chevronUp} className="h-[24px] w-[24px]" />
        </button>
      </div>
    </div>
  );
}
