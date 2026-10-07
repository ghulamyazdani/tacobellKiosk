import { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { paytmSessionEffects } from "@cx-sdk/payments/settlement/paytmKioskSettlement";
import usePaytmSettlement from "../../hooks/paymentsHooks/usePaytmSettlement";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useAdaActive from "../../hooks/utils/useAdaActive";
import ErrorModal from "../../components/common/ErrorModal";
import PleaseWait from "../../components/payment/PleaseWait";
import PaytmQr from "../../components/payment/PaytmQr";
import plasticOverlay from "../../assets/splash/plastic-overlay.jpg";
import tbBellPurple from "../../assets/brand/tb-bell-purple.svg";
import creditCard from "../../assets/payment/credit-card.svg";
import downHereArrow from "../../assets/icons/down-here-arrow.svg";

/** `currencySettings` may also be the number 1 — see setInitialAppSetting. */
interface CurrencySettings {
  symbol?: string;
  currency_symbol?: string;
}

/**
 * /paymentPolling — the Paytm payment screen (P8b-06/07/08). The settlement
 * loop, every exit and the idle hold live in usePaytmSettlement; this file
 * only renders its state.
 *
 * EDC = Figma 1:3404 "FOLLOW PAYMENT INSTRUCTIONS": tb-pink stage + the
 * plastic sheen, purple bell at 128, the 884 column at 435 (title
 * H2 64 / slot 616 with the 431.2×277.2 card / TOTAL bar) on a 100 gap, and
 * DOWN HERE! (−27.12°) + the yellow arrow pointing at the card machine,
 * bottom right. DQR = the same skeleton with the QR in the slot and no
 * DOWN HERE — design language (no QR frame exists), flagged.
 *
 * DESIGN-LANGUAGE ADDITIONS (flagged for client sign-off): the hint line
 * under the TOTAL bar, the countdown, CANCEL PAYMENT (bottom LEFT, clear of
 * the arrow), the terminal-prompt line that replaces the hint after a void
 * reached the card machine, and the modal actions (1:3427 has none).
 *
 * Layers: PleaseWait z-50 < ErrorModal z-80 < idle prompt z-100.
 * The QR only renders while the customer can still pay (awaiting): an
 * expired or abandoned QR is never left scannable under a panel.
 *
 * ADA (design language, flagged): bell dropped, column at 40 with 40 gaps
 * and a 360 slot — title 40–149, slot 189–549, TOTAL 589–713, hint/countdown
 * below it, CANCEL 1012–1104, DOWN HERE + arrow keep their bottom offsets —
 * all inside the 1122 reach zone.
 *
 * The root is overflow-CLIP, never overflow-hidden: in the 1122 zone the
 * turned 1920-tall sheen overflows by 399 px, and a hidden root is a scroll
 * container the browser scrolls to reveal a focused control and never
 * scrolls back (same rule as ReachZone). PleaseWait follows it too.
 */
export default function PaytmPayment() {
  const { t } = useTranslation();
  const ada = useAdaActive();
  const { formatTime } = useAppSettings();
  const currencySettings = useSelector(selectCurrency) as
    | CurrencySettings
    | number
    | undefined;
  const {
    session,
    kind,
    qrCode,
    secondsLeft,
    orderRef,
    amount,
    checking,
    confirmCancel,
    checkAgain,
    finish,
    tryAgain,
    backToBag,
  } = usePaytmSettlement();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const currency = useMemo(() => {
    if (!currencySettings || typeof currencySettings === "number") return "";
    return currencySettings.symbol ?? currencySettings.currency_symbol ?? "";
  }, [currencySettings]);

  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const keepPaying = useCallback(() => setConfirmOpen(false), []);
  const cancelPayment = useCallback(() => {
    setConfirmOpen(false);
    confirmCancel();
  }, [confirmCancel]);

  // No open session: the hook is redirecting (latched at mount).
  if (!session || !kind) return null;

  const edc = kind === "paytmEdc";
  const { phase, reason, terminalPrompt } = session;
  const { poll: inFlight, showCancel } = paytmSessionEffects(session);
  const showPrompt = edc && inFlight && terminalPrompt !== "none";
  const waiting =
    phase === "paid" ||
    ((phase === "cancelling" || phase === "settling") &&
      terminalPrompt === "none");

  return (
    <div
      data-testid="paytm-screen"
      className="relative h-full w-[1080px] overflow-clip bg-tb-pink"
    >
      {/* The frame's sheen: the landscape source turned −90° about the page
          centre, 50 % soft-light — the same recipe as PleaseWait, which
          overlays this screen. */}
      <img
        aria-hidden
        alt=""
        draggable={false}
        src={plasticOverlay}
        className="absolute left-1/2 top-1/2 h-[1080px] w-[1920px] max-w-none -translate-x-1/2 -translate-y-1/2 -rotate-90 object-cover opacity-50 mix-blend-soft-light"
      />
      {!ada && (
        <img
          aria-hidden
          alt=""
          src={tbBellPurple}
          className="absolute left-1/2 top-[128px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}

      <div
        className={`absolute left-1/2 ${ada ? "top-[40px] gap-[40px]" : "top-[435px] gap-[100px]"} flex w-[884px] -translate-x-1/2 flex-col items-center`}
      >
        <h1 className="tb-display text-center text-[64px] leading-[0.85] tracking-[-3px] text-tb-purple">
          {t(edc ? "paytm.instructions.title" : "paytm.qr.title")}
        </h1>

        <div
          className={`flex ${ada ? "size-[360px]" : "size-[616px]"} items-center justify-center`}
        >
          {edc ? (
            <img
              alt=""
              src={creditCard}
              className={ada ? "h-[162px] w-[252px]" : "h-[277.2px] w-[431.2px]"}
            />
          ) : (
            showCancel && <PaytmQr value={qrCode} size={ada ? 360 : 616} />
          )}
        </div>

        <div className="flex w-full flex-col items-center gap-[32px]">
          {/* TOTAL — the amount the bag checked out with; the currency comes
              from settings, never hardcoded. */}
          <div
            data-testid="paytm-total"
            className="flex w-full items-center justify-between rounded-[8px] bg-tb-purple p-[40px]"
          >
            <span className="tb-compressed text-[48px] leading-[44px] text-tb-surface">
              {t("payment.total")}
            </span>
            <span className="tb-compressed text-[48px] leading-[44px] text-tb-surface">
              {currency}
              {amount.toFixed(2)}
            </span>
          </div>

          {showPrompt ? (
            <p
              data-testid="paytm-terminal-prompt"
              role="status"
              className="w-full rounded-[8px] bg-tb-purple px-[32px] py-[20px] text-center text-[30px] font-bold leading-[36px] text-tb-surface"
            >
              {/* YES-only (UI-F3, flagged): polling stops
                  PAYTM_SETTLE_WINDOW_MS after the void with no countdown, so
                  "NO to keep paying" would invite a payment nobody reads. */}
              {t(
                terminalPrompt === "pressYes"
                  ? "paytm.edc.pressYesToCancel"
                  : "paytm.edc.approveOnMachine",
              )}
            </p>
          ) : (
            <p className="w-full text-center text-[28px] font-medium leading-[32px] text-tb-purple">
              {t(edc ? "paytm.edc.hint" : "paytm.qr.hint")}
            </p>
          )}

          {showCancel && (
            <p
              data-testid="paytm-countdown"
              className="tb-display text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
            >
              {t("paytm.timeLeft", { time: formatTime(secondsLeft) })}
            </p>
          )}
        </div>
      </div>

      {edc && (
        <>
          <div
            aria-hidden
            className="absolute bottom-[134px] left-[829px] flex h-[101px] w-[164px] items-center justify-center"
          >
            <p className="w-[171px] -rotate-[27.12deg] text-center text-[24px] font-bold uppercase leading-[1.1] text-tb-purple">
              {t("paytm.instructions.downHere")}
            </p>
          </div>
          <img
            aria-hidden
            alt=""
            src={downHereArrow}
            className="absolute bottom-[15px] left-[902px] size-[172px]"
          />
        </>
      )}

      {showCancel && (
        <button
          type="button"
          data-testid="paytm-cancel"
          onClick={openConfirm}
          className="tb-display absolute bottom-[18px] left-[98px] h-[92px] w-[480px] rounded-[8px] border-2 border-tb-purple text-center text-[28px] leading-[28px] tracking-[1px] text-tb-purple"
        >
          {t("paytm.cancel")}
        </button>
      )}

      {waiting && (
        <PleaseWait
          testId="paytm-confirming"
          subtitle={phase === "cancelling" ? t("paytm.wait.cancelling") : undefined}
        />
      )}

      {confirmOpen && showCancel && (
        <ErrorModal
          testId="paytm-cancel-confirm"
          title={t("paytm.cancelConfirm.title")}
          message={t(
            edc ? "paytm.cancelConfirm.message" : "paytm.cancelConfirm.messageQr",
          )}
          primary={{
            label: t("paytm.cancelConfirm.keep"),
            onClick: keepPaying,
            testId: "paytm-cancel-keep",
          }}
          secondary={{
            label: t("paytm.cancelConfirm.confirm"),
            onClick: cancelPayment,
            testId: "paytm-cancel-yes",
          }}
        />
      )}

      {phase === "notPaid" && reason !== "cancelledByCustomer" && (
        <ErrorModal
          testId="paytm-failed"
          title={t("paytm.failed.title")}
          message={t(
            reason === "expired" ? "paytm.failed.expired" : "paytm.failed.cancelled",
          )}
          primary={{
            label: t("paytm.failed.tryAgain"),
            onClick: tryAgain,
            testId: "paytm-failed-retry",
          }}
          secondary={{
            label: t("orderError.backToBag"),
            onClick: backToBag,
            testId: "paytm-failed-bag",
          }}
        />
      )}

      {phase === "unknown" && (
        <ErrorModal
          testId="paytm-unknown"
          title={t("paytm.unknown.title")}
          message={t("paytm.unknown.message", { order: orderRef })}
          note={checking ? t("paytm.unknown.checking") : undefined}
          primary={{
            label: t("paytm.unknown.checkAgain"),
            onClick: checkAgain,
            testId: "paytm-unknown-check",
          }}
          secondary={{
            label: t("paytm.unknown.finish"),
            onClick: finish,
            testId: "paytm-unknown-finish",
          }}
        />
      )}
    </div>
  );
}
