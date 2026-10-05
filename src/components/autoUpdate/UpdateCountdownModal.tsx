import { useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SPLASH_APPLY_DELAY_MS,
  SPLASH_COUNTDOWN_SECONDS,
} from "@cx-sdk/devices/updates/updatePolicy";

/**
 * The splash update dwell (P9e). MOUNTED ONLY WHILE AN UPDATE IS ARMED, so
 * its tick exists only then (Rule 5), and every disarm — the guest leaving
 * the splash, the Activity Center opening, going offline — resets it by
 * unmounting (the IdlePrompt pattern, routes/IdleGuard.tsx).
 *
 * Invisible for the first 10 s (the splash stays fully usable); a
 * NON-dismissable countdown for the last 5 (fork parity, ≤5 s — flagged for
 * sign-off: a tap there is swallowed); at 0 it calls onElapsed ONCE and says
 * "Updating…" until the page leaves. Design language, no Figma frame
 * (flagged): the ErrorModal card without buttons or icon, honest copy, no
 * fake progress. z-80 (the ErrorModal tier): above the splash hotspot (z-20);
 * the Activity Center (z-50) never coexists with it.
 */
export default function UpdateCountdownModal({
  onElapsed,
}: {
  onElapsed: () => void;
}) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(SPLASH_APPLY_DELAY_MS / 1000);
  const elapsed = useEffectEvent(onElapsed);

  // ONE interval owns the count (its own closure), so a single fake-clock
  // jump drives the whole dwell — no per-tick re-arm waiting on a React
  // commit — and it stops itself at 0, firing onElapsed exactly once.
  // StrictMode's mount re-run clears the first interval before any tick.
  useEffect(() => {
    let seconds = SPLASH_APPLY_DELAY_MS / 1000;
    const id = window.setInterval(() => {
      seconds -= 1;
      setLeft(seconds);
      if (seconds > 0) return;
      window.clearInterval(id);
      elapsed();
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (left > SPLASH_COUNTDOWN_SECONDS) return null;

  return (
    <div
      data-testid="update-countdown"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-countdown-title"
      aria-describedby="update-countdown-body"
      className="absolute inset-0 z-[80]"
    >
      <div aria-hidden className="absolute inset-0 bg-tb-purple/80" />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 flex w-[680px] flex-col items-center gap-[24px] rounded-[16px] bg-tb-surface px-[24px] py-[80px] text-center">
        <h2
          id="update-countdown-title"
          className="tb-display text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
        >
          {t("update.title")}
        </h2>
        <p
          data-testid="update-countdown-status"
          className="text-[28px] leading-[32px] text-tb-ink-purple"
        >
          {left > 0
            ? t("update.countdown", { seconds: left })
            : t("update.inProgress")}
        </p>
        <p
          id="update-countdown-body"
          className="text-[22px] leading-[26px] text-tb-ink-purple/70"
        >
          {t("update.body")}
        </p>
      </div>
    </div>
  );
}
