import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useAuthHook from "../../hooks/utils/useAuthHook";
import KioskKeyboard from "../../components/keyboard/KioskKeyboard";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import tbBell from "../../assets/brand/tb-bell.svg";
import inputClear from "../../assets/icons/input-clear.svg";

/**
 * Device registration (license code → authApi → token). No Figma frame exists
 * for this operator-facing screen — TB design language, flagged for client
 * sign-off. Flow parity with posistKiosk: success → /LoadingResources.
 */
export default function Registration() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { authenticateKiosk, isAuthenticateLoading } = useAuthHook();

  const [code, setCode] = useState("");
  const [error, setError] = useState<{ status: boolean; message: string }>({
    status: false,
    message: "",
  });

  // One dismiss timer at a time: a second error restarts the 3 s window
  // instead of being cleared early by the first one's timer, and leaving the
  // screen never leaves a timer behind (Rule 5).
  const errorTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (errorTimer.current) window.clearTimeout(errorTimer.current);
    },
    [],
  );
  const closeError = useCallback(() => {
    if (errorTimer.current) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(
      () => setError({ status: false, message: "" }),
      3000,
    );
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCode(text.trim().slice(0, 16));
    } catch {
      // Clipboard unavailable (permissions) — operator can type the code.
    }
  };

  const handleActivate = async () => {
    if (code.length === 0) {
      setError({ status: true, message: t("registration.emptyCode") });
      closeError();
      return;
    }
    captureKioskEvent(KioskEventName.SignInStarted, {});
    const auth = await authenticateKiosk(code.trim());
    if (auth.error === null) {
      captureKioskEvent(KioskEventName.SignInFinished, {
        auth_status: "success",
      });
      captureKioskEvent(KioskEventName.RegistrationFinished, {});
      navigate("/LoadingResources");
    } else {
      setError({ status: true, message: auth.error });
      closeError();
    }
  };

  return (
    <div
      data-testid="registration-screen"
      className="relative flex h-[1920px] w-[1080px] flex-col items-center bg-tb-purple"
    >
      {/* Pure-CSS motion (rAF animations freeze in occluded windows). The
          banner slides on the `translate` property alone; the submit button
          shakes on `rotate` and presses on `scale` — separate properties, so
          they compose instead of fighting over `transform`. */}
      <style>{`@keyframes tbRegistrationShake{0%,100%{rotate:0deg}20%,60%{rotate:1deg}40%,80%{rotate:-1deg}}`}</style>
      <div
        className={`absolute top-0 z-50 flex w-full items-center justify-center bg-red-600 px-8 py-6 text-2xl font-bold text-white transition-transform duration-[400ms] ${
          error.status ? "translate-y-0" : "-translate-y-[120px]"
        }`}
        data-testid="registration-error"
      >
        {error.message}
      </div>

      <img alt="Taco Bell" src={tbBell} className="mt-[140px] h-[110px]" />
      <h1 className="tb-display mt-[80px] max-w-[860px] text-center text-[72px] leading-[0.95] tracking-[-3px] text-tb-surface">
        {t("registration.title")}
      </h1>
      <p className="mt-8 max-w-2xl text-center text-2xl text-tb-cream">
        {t("registration.subtitle")}
      </p>

      {/* Input styled per Figma Email-Receipt field (1:1047): white, 2px
          vibrant-purple border, rounded-10, clear-X on the right. */}
      <div
        data-testid="registration-code"
        className="relative mt-[80px] flex h-[100px] w-[844px] items-center rounded-[10px] border-2 border-tb-purple-vibrant bg-tb-surface px-8 text-[28px] font-medium tracking-[2px] text-black"
      >
        {code || (
          <span className="text-black/55">{t("registration.placeholder")}</span>
        )}
        {code && (
          <button
            type="button"
            aria-label={t("registration.clear")}
            data-testid="registration-clear"
            onClick={() => setCode("")}
            className="absolute right-[24px] h-[44px] w-[44px] p-[10px]"
          >
            <img alt="" src={inputClear} className="h-full w-full" />
          </button>
        )}
      </div>

      <div className="mt-6 flex gap-4">
        <button
          type="button"
          onClick={handlePaste}
          className="min-h-[44px] min-w-[44px] rounded-full border-2 border-tb-surface px-10 py-4 text-xl font-bold uppercase text-tb-surface"
        >
          {t("registration.paste")}
        </button>
        {/* Ink-purple on pink (7.73:1, the house pink-CTA pattern); white
            was 2.46:1. */}
        <button
          type="button"
          data-testid="registration-submit"
          onClick={handleActivate}
          disabled={isAuthenticateLoading}
          className="min-h-[44px] min-w-[44px] rounded-full bg-tb-pink px-14 py-4 text-xl font-black uppercase text-tb-ink-purple transition-transform active:scale-95 disabled:opacity-60"
          style={
            error.status
              ? { animation: "tbRegistrationShake 0.4s ease-in-out" }
              : undefined
          }
        >
          {isAuthenticateLoading
            ? t("registration.activating")
            : t("registration.activate")}
        </button>
      </div>

      <div className="absolute bottom-[90px] w-full px-[40px]">
        <KioskKeyboard
          value={code}
          onChange={setCode}
          maxLength={16}
          onSubmit={handleActivate}
        />
      </div>
    </div>
  );
}
