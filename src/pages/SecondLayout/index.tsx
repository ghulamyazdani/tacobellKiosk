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
import {
  selectSelectedLanguage,
  selectSecondaryLanguage,
} from "../../redux/features/multiLanguage/multiLanguage.slice";
import useKioskOpenServices from "../../hooks/kioskOpen/useKioskOpenServices";
import useMenuConverters from "../../hooks/menuHooks/useMenuConverters";
import useAppSettings from "../../hooks/utils/useAppSettings";
import DaypartTicker from "../../components/chrome/DaypartTicker";
import FooterBar from "../../components/chrome/FooterBar";
import LanguageSheet from "../../components/language/LanguageSheet";
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
 */
export default function SecondLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const pipelines = (useSelector(selectPipelines) ?? []) as Pipeline[];
  const selectedLanguage = useSelector(selectSelectedLanguage);
  const secondaryLanguage = useSelector(selectSecondaryLanguage);
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
  const isProcessing = useRef(false);

  // Refresh per-pipeline open state on mount (fork parity).
  useEffect(() => {
    const ids = pipelines.map((p) => p._id).filter(Boolean);
    if (ids.length > 0) {
      checkAllPipelinesWithIds(ids);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only refresh
  }, []);

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

      setIsFetching(true);
      await fetchMenu(pipeline.tab_id, false, false, pipeline);

      navigate(getIsLoyaltyOn() ? "/phone" : "/menu");
    } finally {
      setIsFetching(false);
      isProcessing.current = false;
    }
  };

  return (
    <div
      data-testid="second-screen"
      className="relative h-[1920px] w-[1080px] overflow-hidden bg-tb-purple"
    >
      <div
        aria-hidden
        className="absolute inset-0"
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
        className="absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-soft-light"
      />

      <div className="absolute left-0 top-0 w-full">
        <DaypartTicker />
      </div>

      <img
        alt="Taco Bell"
        src={tbBell}
        className="absolute left-1/2 top-[327px] h-[89px] w-[100px] -translate-x-1/2"
      />

      <div className="absolute left-1/2 top-1/2 w-[856px] -translate-x-1/2 -translate-y-1/2">
        <h1 className="tb-display mb-[64px] text-center text-[116px] leading-[98px] tracking-[-3.27px] text-tb-surface">
          {t("second.title")}
        </h1>
        <div className="flex flex-wrap justify-center gap-[24px]">
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
                }`}
              >
                <img
                  alt=""
                  src={iconForPipeline(pipeline)}
                  className="h-[128px] w-[128px]"
                />
                <span className="tb-compressed text-center text-[48px] leading-[44px] text-tb-purple">
                  {pipeline.primary_name ?? pipeline.name}
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
    </div>
  );
}
