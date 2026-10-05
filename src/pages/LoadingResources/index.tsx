import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useLoaders from "../../hooks/utils/useLoaders";
import tbBell from "../../assets/brand/tb-bell.svg";

/**
 * Boot screen: runs the P3 resource loader once. Success → /start.
 * Failure → inline configuration error + return-to-registration.
 * (A 401 during boot never reaches the error branch — the transport's
 * recoverFromAuthFailure clears the token and redirects to "/".)
 */
export default function LoadingResources() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { LoadResourcesInitially } = useLoaders();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    // StrictMode double-invoke guard: the boot fan-out must run once.
    if (startedRef.current) return;
    startedRef.current = true;
    LoadResourcesInitially(
      (message) => setError(message),
      () => navigate("/start")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot boot
  }, []);

  return (
    <div
      data-testid="loading-resources"
      className="flex h-[1920px] w-[1080px] flex-col items-center justify-center gap-10 bg-tb-purple"
    >
      <img alt="Taco Bell" src={tbBell} className="h-[110px]" />
      {error ? (
        <>
          <h1 className="tb-display max-w-[860px] text-center text-5xl text-tb-surface">
            {t("loading.errorTitle")}
          </h1>
          <p
            data-testid="loading-error"
            className="max-w-[760px] text-center text-2xl text-tb-cream"
          >
            {error}
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="min-h-[44px] min-w-[44px] rounded-full bg-tb-pink px-12 py-5 text-xl font-black uppercase text-white"
          >
            {t("loading.backToRegistration")}
          </button>
        </>
      ) : (
        <>
          <div className="h-[8px] w-[520px] overflow-hidden rounded-full bg-tb-surface/20">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-tb-pink" />
          </div>
          <p className="text-2xl text-tb-cream">{t("loading.preparing")}</p>
        </>
      )}
    </div>
  );
}
