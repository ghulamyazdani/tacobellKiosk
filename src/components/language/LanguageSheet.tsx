import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  selectPrimaryLanguage,
  selectSecondaryLanguage,
  selectSelectedLanguage,
  setSelectedLanguage,
} from "../../redux/features/multiLanguage/multiLanguage.slice";
import closeIcon from "../../assets/icons/close.svg";

interface LanguageOption {
  name?: string;
  code?: string;
  dir?: string;
  type?: string;
}

interface LanguageSheetProps {
  open: boolean;
  onClose: () => void;
}

const withDirection = (lang: LanguageOption) => ({
  ...lang,
  dir: lang?.dir ?? (lang?.code === "ar" ? "rtl" : "ltr"),
});

/**
 * Bottom sheet — Figma "Select Language" (1:4488): purple scrim, white
 * sheet (rounded-top 60), selected language filled, others outlined.
 * Options come from the CX language settings (multiLanguage slice).
 */
export default function LanguageSheet({ open, onClose }: LanguageSheetProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const primary = useSelector(selectPrimaryLanguage) as LanguageOption | null;
  const secondary = useSelector(selectSecondaryLanguage) as LanguageOption | null;
  const selected = useSelector(selectSelectedLanguage) as LanguageOption | null;

  const options = [primary, secondary].filter(
    (l): l is LanguageOption => Boolean(l && l.code)
  );
  // `||` not `??`: the slice initializes selectedLanguage.code to "" (empty
  // string), which must fall back to the primary language.
  const selectedCode = selected?.code || primary?.code;

  const choose = (lang: LanguageOption) => {
    dispatch(setSelectedLanguage(withDirection(lang)));
    onClose();
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40" data-testid="language-sheet">
      {/* Pure-CSS entrance, position-neutral (translateY only — tb-modal-enter
          is for centred modals). No exit animation: the sheet unmounts at
          once, like every other sheet (house pattern). */}
      <style>{`@keyframes tbLanguageScrimEnter{from{opacity:0}to{opacity:1}}@keyframes tbLanguageSheetEnter{from{transform:translateY(480px)}to{transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
        style={{ animation: "tbLanguageScrimEnter 0.25s ease-out both" }}
      />
      <div
        className="absolute bottom-0 left-0 w-[1080px] rounded-t-[60px] bg-tb-surface px-[24px] pb-[54px] pt-[54px]"
        style={{ animation: "tbLanguageSheetEnter 0.25s ease-out both" }}
      >
        <h2 className="tb-display mb-[64px] text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple">
          {t("language.title")}
        </h2>
        <button
          type="button"
          aria-label={t("language.close")}
          onClick={onClose}
          className="absolute right-[44px] top-[44px] h-[48px] w-[48px] min-h-[44px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>
        <div className="flex flex-col gap-[24px] px-[24px] pb-[24px]">
          {options.map((lang) => {
            const isSelected = lang.code === selectedCode;
            return (
              <button
                key={lang.code}
                type="button"
                data-testid={`language-${lang.code}`}
                onClick={() => choose(lang)}
                className={`tb-display w-full rounded-[8px] py-[32px] text-center text-[24px] leading-[32px] min-h-[44px] ${
                  isSelected
                    ? "bg-tb-purple text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)]"
                    : "border border-tb-purple text-tb-purple"
                }`}
              >
                {lang.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
