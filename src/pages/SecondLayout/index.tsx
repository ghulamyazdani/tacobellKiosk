import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  selectPipelines,
  setSelectedPipeline,
  setTabType,
} from "@cx-sdk/catalog/state/pipeline.slice";
import { setSelectedTabId } from "@cx-sdk/core/auth/authentication.slice";
import { resetCategorySelection } from "@cx-sdk/catalog/state/Menu.slice";
import { kiosSettingsRdx } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  selectSelectedLanguage,
  selectSecondaryLanguage,
} from "../../redux/features/multiLanguage/multiLanguage.slice";
import useKioskOpenServices from "../../hooks/kioskOpen/useKioskOpenServices";
import useMenuConverters from "../../hooks/menuHooks/useMenuConverters";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useAdaActive from "../../hooks/utils/useAdaActive";
import useLocalized from "../../hooks/utils/useLocalized";
import DaypartTicker from "../../components/chrome/DaypartTicker";
import FooterBar from "../../components/chrome/FooterBar";
import LanguageSheet from "../../components/language/LanguageSheet";
import ErrorModal from "../../components/common/ErrorModal";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import plasticOverlay from "../../assets/splash/plastic-overlay.jpg";
import tbBell from "../../assets/brand/tb-bell.svg";
import dineInIcon from "../../assets/icons/dine-in.svg";
import takeOutIcon from "../../assets/icons/take-out.svg";

interface Pipeline {
  _id: string;
  tab_id?: string;
  tab_type?: string;
  primary_name?: string;
  secondary_name?: string;
  name?: string;
  deployments?: string[];
}

const iconForPipeline = (pipeline: Pipeline) =>
  /take|away|out/i.test(pipeline?.tab_type ?? "") ? takeOutIcon : dineInIcon;

/**
 * Order-type screen — Figma "Dine In / Take Out / Daypart v1" (1:2581).
 * Cards are DATA-DRIVEN from the CX pipelines loaded at boot; closed
 * pipelines grey out via kioskOpenStatus. Selection wiring mirrors
 * posistKiosk's handleSelectPipeline (menu/charges fetch arrives in P5).
 *
 * ADA (P9c, design-language — no Figma frame, flagged for client sign-off):
 * the page renders into the 1122px reach zone. The bell is dropped (the
 * brand zone above carries the lockup); the ticker, the `top-1/2` block
 * (3-line title + mb-64 + one 416px card row = 774px, i.e. y 174–948) and
 * the footer (1066–1122) already fit. A second card ROW would not, so with
 * more than two pipelines the cards become one horizontal swipe row at full
 * size (fork parity — cards are never shrunk), the third card peeking in.
 */
export default function SecondLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const ada = useAdaActive();
  const pipelines = (useSelector(selectPipelines) ?? []) as Pipeline[];
  const scrollRow = ada && pipelines.length > 2;
  const selectedLanguage = useSelector(selectSelectedLanguage);
  const secondaryLanguage = useSelector(selectSecondaryLanguage);
  const { isSecondary, pipelineName, text } = useLocalized();
  // 27b (D5): the ticker shows the guest's slot of kiosk_settings
  // .pipeline_text_* (the fork's /second message) when set; unset or blank
  // keeps DaypartTicker's t("ticker.lunch"). No cross-language fallback
  // (fork getPipelineTextDescription) — the MIAM headline's rule.
  const tickerSetting: unknown = useSelector(
    (state) =>
      kiosSettingsRdx(state)?.[
        isSecondary ? "pipeline_text_secondary" : "pipeline_text_primary"
      ]
  );
  const tickerCopy =
    typeof tickerSetting === "string" && tickerSetting.trim()
      ? text(tickerSetting.trim())
      : undefined;
  const { checkPipelineClosedFromRedux, checkAllPipelinesWithIds } =
    useKioskOpenServices();

  const { fetchMenu } = useMenuConverters();
  // getIsLoyaltyOn() = kiosk_settings.enable_loyalty AND state.loyalty
  // .isLoyaltyOn (a partner actually resolved at boot). The raw isLoyaltyOn
  // selector alone would send the guest to /phone on a deployment whose
  // settings have loyalty switched off but whose partner blob is still in
  // persisted state — both must agree.
  const { getChargesCountryDataApi, getIsLoyaltyOn } = useAppSettings();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  // The pipeline whose menu failed to load — drives the error dialog.
  const [failedPipeline, setFailedPipeline] = useState<Pipeline | null>(null);
  const isProcessing = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Refresh per-pipeline open state on mount (fork parity).
  useEffect(() => {
    const ids = pipelines.map((p) => p._id).filter(Boolean);
    if (ids.length > 0) {
      checkAllPipelinesWithIds(ids);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only refresh
  }, []);

  /**
   * Fetch the pipeline's menu, then enter it. Shared by the card tap and the
   * error dialog's TRY AGAIN, so a retry re-runs ONLY the fetches (no second
   * PipelineSelected/OrderTypeSelected event, no re-dispatch).
   */
  const loadMenuAndEnter = async (pipeline: Pipeline) => {
    setFailedPipeline(null);
    setIsFetching(true);
    try {
      const menu = await fetchMenu(pipeline.tab_id, false, false, pipeline);
      // Rule 1: the fetch is not idle-held, so the session can end (idle →
      // /start) while it is in flight. A late response must not drive the
      // emptied kiosk off the splash into /menu or /phone.
      if (!mountedRef.current) return;
      // Rule 2/3 (P9b): fetchMenu swallows EVERY failure (network, timeout,
      // 5xx, bad body, converter throw) and resolves {} — fork parity. Judge
      // the RETURN value, never the redux menu: after a nextCustomer reset
      // that still holds the PREVIOUS pipeline's items and prices.
      if (!menu?.categories?.length) {
        setFailedPipeline(pipeline);
        return;
      }
      navigate(getIsLoyaltyOn() ? "/phone" : "/menu");
    } finally {
      setIsFetching(false);
    }
  };

  /** TRY AGAIN — same pipeline, same request set. */
  const retryMenu = async () => {
    if (!failedPipeline || isProcessing.current) return;
    isProcessing.current = true;
    try {
      // The tap's charges call usually failed with the menu (same blip), and
      // only a success rewrites the stored charges — skip it and the bill
      // carries the last good pipeline's charges (money, Rule 3).
      getChargesCountryDataApi(failedPipeline.tab_id);
      await loadMenuAndEnter(failedPipeline);
    } finally {
      isProcessing.current = false;
    }
  };

  const handleSelectPipeline = async (pipeline: Pipeline) => {
    if (isProcessing.current) return; // double-tap guard (fork parity)
    isProcessing.current = true;
    try {
      const openState = checkPipelineClosedFromRedux(pipeline._id);
      if (openState.status === false) return;

      captureKioskEvent(KioskEventName.PipelineSelected, {
        pipeline_id: pipeline._id,
        pipeline_name: pipeline.primary_name,
        tab_type: pipeline.tab_type,
      });
      captureKioskEvent(KioskEventName.OrderTypeSelected, {
        tab_type: pipeline.tab_type,
        pipeline_id: pipeline._id,
      });
      dispatch(
        setSelectedPipeline({
          ...pipeline,
          primaryCode: selectedLanguage?.code ?? "",
          secondaryCode: secondaryLanguage?.code ?? "",
        })
      );
      dispatch(setSelectedTabId(pipeline.tab_id));
      getChargesCountryDataApi(pipeline.tab_id);
      dispatch(setTabType(pipeline.tab_type));
      dispatch(resetCategorySelection());

      await loadMenuAndEnter(pipeline);
    } finally {
      isProcessing.current = false;
    }
  };

  return (
    <div
      data-testid="second-screen"
      className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
    >
      {/* Both layers are stage-sized and bottom-anchored, i.e. registered to
          the STAGE, not the page: in ADA (page = the reach zone) the tile
          and the sheen crop continue the brand zone's across the seam
          instead of restarting at its edge. Normal mode: the same box as
          inset-0. */}
      <div
        aria-hidden
        className="absolute bottom-0 left-0 h-[1920px] w-[1080px]"
        style={{
          backgroundImage: `url(${bgTexture})`,
          backgroundSize: "240px 240px",
          backgroundPosition: "top left",
        }}
      />
      <img
        aria-hidden
        alt=""
        src={plasticOverlay}
        className="absolute bottom-0 left-0 h-[1920px] w-[1080px] object-cover opacity-40 mix-blend-soft-light"
      />

      <div className="absolute left-0 top-0 w-full">
        <DaypartTicker message={tickerCopy} />
      </div>

      {!ada && (
        <img
          alt="Taco Bell"
          src={tbBell}
          className="absolute left-1/2 top-[327px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}

      <div className="absolute left-1/2 top-1/2 w-[856px] -translate-x-1/2 -translate-y-1/2">
        <h1 className="tb-display mb-[64px] text-center text-[116px] leading-[98px] tracking-[-3.27px] text-tb-surface">
          {t("second.title")}
        </h1>
        {/* scrollRow: -mx-[112px] widens the row to the full 1080 stage so the
            cards swipe edge to edge; px-[112px] keeps card 1 on the block's
            left edge. Cards are shrink-0 or the nowrap row would squeeze them. */}
        <div
          className={
            scrollRow
              ? "-mx-[112px] flex gap-[24px] overflow-x-auto px-[112px] [scrollbar-width:none]"
              : "flex flex-wrap justify-center gap-[24px]"
          }
        >
          {pipelines.map((pipeline) => {
            const openState = checkPipelineClosedFromRedux(pipeline._id);
            const closed = openState.status === false;
            return (
              <button
                key={pipeline._id}
                type="button"
                data-testid={`pipeline-${pipeline._id}`}
                disabled={closed}
                onClick={() => handleSelectPipeline(pipeline)}
                className={`relative flex h-[416px] w-[416px] min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-[58px] rounded-[8px] border-2 border-tb-surface bg-tb-surface px-[40px] py-[80px] ${
                  closed ? "opacity-50" : "active:scale-[0.98]"
                }${scrollRow ? " shrink-0" : ""}`}
              >
                <img
                  alt=""
                  src={iconForPipeline(pipeline)}
                  className="h-[128px] w-[128px]"
                />
                <span className="tb-compressed text-center text-[48px] leading-[44px] text-tb-purple">
                  {pipelineName(pipeline)}
                </span>
                {closed && (
                  <span className="tb-display absolute bottom-[24px] rounded-full bg-tb-ink-purple px-6 py-2 text-[18px] text-tb-surface">
                    {t("second.closed")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {isFetching && (
        <div
          data-testid="menu-fetching"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-tb-purple/90"
        >
          <div className="h-[8px] w-[420px] overflow-hidden rounded-full bg-tb-surface/20">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-tb-pink" />
          </div>
          <p className="tb-display text-3xl text-tb-surface">{t("second.preparingMenu")}</p>
        </div>
      )}
      <FooterBar
        onCancelOrder={() => navigate("/start")}
        onOpenLanguage={() => setLanguageOpen(true)}
      />
      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
      {/* No auto-retry: the guest is right here. BACK returns to the cards
          (footer Cancel → /start, language) — Rule 1, never a dead end. */}
      {failedPipeline && (
        <ErrorModal
          testId="menu-error"
          title={t("menuError.title")}
          message={t("menuError.message")}
          primary={{
            label: t("menuError.retry"),
            testId: "menu-error-retry",
            onClick: () => void retryMenu(),
          }}
          secondary={{
            label: t("menuError.back"),
            testId: "menu-error-back",
            onClick: () => setFailedPipeline(null),
          }}
        />
      )}
    </div>
  );
}
