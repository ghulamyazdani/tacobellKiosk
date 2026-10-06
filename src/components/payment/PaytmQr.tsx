import { useTranslation } from "react-i18next";
// NAMED + STATIC on purpose. Named: the package is CJS, and a default import
// under Vite 8 / Rolldown yields the namespace object, not the component
// (src/types/react-qr-code.d.ts). Static: it rides in the /paymentPolling
// chunk (paytmRuntime, loaded before any poll — see PaytmPaymentRoute); a
// chunk of its own would be a second failure point mid-payment.
import { QRCode } from "react-qr-code";
import { ErrorBoundary } from "../../ErrorBoundary";

interface PaytmQrProps {
  /** Paytm's raw UPI intent string (`payment.paytmQrCode`). Never logged. */
  value: string;
  /** Edge of the white card, design px (the 1:3404 616 slot). */
  size?: number;
}

// ponytail: the module count is unknown until the encoder runs, so the quiet
// zone is sized for the SMALLEST QR (version 1, 21 modules): 4 modules each
// side = 4/29 of the card. Every larger version gets more than 4 modules.
// Exact sizing would need the encoder's module count — not worth a 2nd pass.
const QUIET_ZONE_FRACTION = 4 / 29;

/**
 * The Paytm Dynamic QR (P8b-07, user decision D1). Design language — no
 * Figma frame shows a QR (flagged): a white rounded card in the 1:3404 slot,
 * black-on-white modules, the encoder's default level "L" (fork parity,
 * Polling.tsx). The payload is Paytm's UPI string — the backend drops the
 * image Paytm returns — so it is encoded on the kiosk.
 *
 * Rule 4: the encoder sits behind the LOCAL ErrorBoundary, so a throw shows
 * "QR code unavailable" in place (CANCEL stays live) instead of the global
 * crash screen and its reload to /start mid-payment. Renders nothing for a
 * blank payload: a QR that scans to nothing is never shown.
 */
export default function PaytmQr({ value, size = 616 }: PaytmQrProps) {
  const { t } = useTranslation();
  // typeof: the value comes from a persisted slice; junk is not a QR.
  if (typeof value !== "string" || value.trim() === "") return null;

  const quietZone = Math.ceil(size * QUIET_ZONE_FRACTION);
  const card = "flex items-center justify-center rounded-[16px] bg-tb-surface";

  return (
    <ErrorBoundary
      fallback={
        <div
          data-testid="paytm-qr-unavailable"
          className={`${card} px-[48px] text-center text-[28px] leading-[32px] text-tb-ink-purple`}
          style={{ width: size, height: size }}
        >
          {t("paytm.qr.unavailable")}
        </div>
      }
    >
      {/* ph-no-capture: PostHog never records the QR — session replay blocks
          the card, autocapture skips taps on it (Rule 3: the QR string never
          reaches analytics). */}
      <div
        data-testid="paytm-qr"
        role="img"
        aria-label={t("paytm.qr.title")}
        className={`${card} ph-no-capture`}
        style={{ width: size, height: size }}
      >
        <QRCode value={value} size={size - 2 * quietZone} />
      </div>
    </ErrorBoundary>
  );
}
