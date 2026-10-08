import { useEffect, type JSX } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  selectErrorMessageGlobal,
  selectShowErrorModalGlobal,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import ErrorModal from "./ErrorModal";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/**
 * The ONE renderer of the global error flag (`setShowErrorModalGlobal`):
 * PAY failures, the DP session cap, customization limits, the loyalty entry
 * guards. Dispatch a TRANSLATED string; never render the flag page-locally.
 *
 * Design language of Figma "Icon Modal" 1:6288 (no frame exists for the
 * fork's top banner): the message IS the uppercase H5 title, no body, one
 * full-width GOT IT. No auto-dismiss (WCAG 2.2.1; the fork's 3 s banner
 * would fail it) — GOT IT only. Mounted by IdleGuard, so it lives exactly in
 * the in-session subtree (never over /start, Registration or the boot), and
 * statically: an error surface that can fail to load is the bug it fixes.
 * z-[95]: above every page overlay and the bag, below the idle prompt (100)
 * and the offline overlay (99999).
 */
export default function GlobalErrorHost(): JSX.Element | null {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const open = Boolean(useSelector(selectShowErrorModalGlobal));
  const message = String(useSelector(selectErrorMessageGlobal) ?? "");

  // Fork ErrorCard parity: one event per open and per new message.
  useEffect(() => {
    if (!open) return;
    captureKioskEvent(KioskEventName.ErrorOccurred, {
      error_source: "global_banner",
      error_message: message,
    });
  }, [open, message]);

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[95]">
      <ErrorModal
        testId="global-error"
        icon
        wide
        title={message || t("bag.checkoutFailed")}
        primary={{
          label: t("offers.gotIt"),
          testId: "global-error-ok",
          onClick: () =>
            dispatch(
              setShowErrorModalGlobal({ showErrorModal: false, errorMessage: "" })
            ),
        }}
      />
    </div>
  );
}
