/* eslint-disable no-restricted-globals --
 * The raw localStorage writes below are FORK PARITY: posistKiosk mirrors a
 * few kiosk settings into localStorage for legacy warm-boot fallbacks. They
 * fold into the persistence manifest in a later phase.
 */
import { useDispatch, useSelector } from "react-redux";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import {
  useFetchCXPipelinesMutation,
  useGetKioskSettingsMutation,
  useGetLanguageMutation,
} from "@cx-sdk/catalog/services/kioskInfoApi";
import { useGetCxSkinDataMutation } from "@cx-sdk/catalog/services/settingsApi";
import { useGetLoyaltyPartnerMutation } from "@cx-sdk/ordering/services/loyaltyApi";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import {
  setAutoAdjustFontSize,
  setEnableAccessibilityMode,
  setEnableBannerCollapse,
  setEnableFullWidthBanner,
  setHideComboConstituentAddons,
  setHideFilter,
  setHidePlusIconFromItem,
  setIdealTimeout,
  setKioskSettings,
  setOneCategoryAtATime,
  setQuickCustomizationMode,
  setShowRepeatCustomization,
  setShowSelectionText,
  setShowUpsellingItemAsSeperateItem,
  setStickyDuration,
  setTemplateType,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setLanguages } from "../../redux/features/multiLanguage/multiLanguage.slice";
import useFetchColors from "./colorManagement/useFetchColors";
import { resetDatabase } from "../../models/db";

/**
 * P3 boot loader — posistKiosk's LoadResourcesInitially in the SAME ORDER,
 * with not-yet-ported subsystems deferred (each marked):
 *   language → skin → pipelines → theme → kiosk settings → loyalty partner
 *   → success
 * Deferred: media conversion (P4), deployment info + payment settings +
 * terminal sockets (P8), MIAM texts (P6), recommendations (P7),
 * cluster settings (P5).
 *
 * Any 401 inside this sequence triggers the transport's onAuthFailure
 * (sessionRecovery.recoverFromAuthFailure): token cleared, RESET_STATE,
 * redirect to Registration — THE stale-device logout path.
 */
function useLoaders() {
  const dispatch = useDispatch();
  const deploymentDetails = useSelector(selectDeploymentDetails);
  const { FetchThemeData } = useFetchColors();

  const [getLanguageFromApi] = useGetLanguageMutation();
  const [getCxSkinData] = useGetCxSkinDataMutation();
  const [fetchCXPipelines] = useFetchCXPipelinesMutation();
  const [getKioskSettings] = useGetKioskSettingsMutation();
  const [getLoyaltyPartner] = useGetLoyaltyPartnerMutation();

  const LoadResourcesInitially = async (
    errorCallback: (message: string) => void,
    successCallback: () => void
  ) => {
    try {
      await resetDatabase();

      //// Language
      let isSecondarySet = false;
      const languageData = await getLanguageFromApi({
        brand_id: deploymentDetails?.brand_id,
      }).unwrap();
      if (languageData) {
        if (
          languageData?.secondary_language &&
          Object.keys(languageData.secondary_language).length > 0
        ) {
          isSecondarySet = true;
        }
        if (
          !languageData?.primary_language ||
          Object.keys(languageData.primary_language).length === 0
        ) {
          throw new Error("Primary Language Not Set in the settings");
        }
        dispatch(setLanguages(languageData));
      } else {
        throw new Error("Language Not Set in the settings");
      }

      //// Skin (fork parity; Taco Bell renders its own shell regardless)
      const skinCx = await getCxSkinData({ app: "Kiosk", channel: "Kiosk" });
      if (skinCx && "data" in skinCx && skinCx.data?.skin_id === "skin_2") {
        dispatch(setTemplateType("albaik"));
      } else {
        dispatch(setTemplateType("default"));
      }

      //// Pipelines
      const fetchData = await fetchCXPipelines({
        cluster_id: deploymentDetails?.cluster_id,
      }).unwrap();
      const availableData = (fetchData ?? []).filter(
        (entity: { deployments?: string[] }) => {
          if (!entity?.deployments || entity.deployments.length === 0) {
            return true;
          }
          return !entity.deployments.includes(deploymentDetails?._id);
        }
      );
      dispatch(setPipelines(availableData));
      if (availableData?.length === 0) {
        throw new Error("No Pipeline Data Found, Please show the pipelines");
      }

      //// Theme → --brand-* CSS variables
      FetchThemeData();

      //// Kiosk settings (verbatim decision block from the fork)
      const settingsData = await getKioskSettings({
        brand_id: deploymentDetails?.brand_id,
        tenant_id: deploymentDetails?.tenant_id,
        channel: "Kiosk",
      }).unwrap();

      dispatch(setOneCategoryAtATime(Boolean(settingsData?.one_category_at_a_time)));
      dispatch(setShowRepeatCustomization(!settingsData?.remove_repeat_customization_modal));
      dispatch(setQuickCustomizationMode(Boolean(settingsData?.quick_customization_mode)));
      if (settingsData?.accessibility_mode !== undefined) {
        dispatch(setEnableAccessibilityMode(settingsData.accessibility_mode));
      }
      dispatch(setEnableFullWidthBanner(Boolean(settingsData?.full_width_banner)));
      dispatch(setHideFilter(Boolean(settingsData?.hide_filter)));
      dispatch(setHideComboConstituentAddons(Boolean(settingsData?.hide_combo_constituent_add_ons)));
      const showSelectionText = settingsData?.show_selection_text_in_customization === true;
      dispatch(setShowSelectionText(showSelectionText));
      localStorage.setItem("showSelectionText", String(showSelectionText));
      localStorage.setItem("kiosk_settings", JSON.stringify(settingsData));
      dispatch(setKioskSettings(settingsData));
      dispatch(setEnableBannerCollapse(Boolean(settingsData?.enable_banner_collapes)));

      if (!settingsData?.start_order_text_primary) {
        throw new Error("Primary Text not Set in the settings");
      }
      if (isSecondarySet && !settingsData?.start_order_text_secondary) {
        throw new Error("Secondary Text not Set in the settings");
      }
      if (settingsData?.ideal_time) {
        dispatch(setIdealTimeout(parseInt(settingsData.ideal_time)));
      } else {
        throw new Error("Idle Time Not set in the settings");
      }
      if (
        settingsData?.proximity_sensor_camera_detection_delay &&
        settingsData.proximity_sensor_camera_detection_delay > 0
      ) {
        dispatch(
          setStickyDuration(
            parseInt(settingsData.proximity_sensor_camera_detection_delay) * 1000
          )
        );
      } else {
        dispatch(setStickyDuration(10000));
      }
      dispatch(setHidePlusIconFromItem(settingsData?.hide_plus_icon_from_item !== false));
      dispatch(setAutoAdjustFontSize(Boolean(settingsData?.auto_adjust_font_size)));
      dispatch(setShowUpsellingItemAsSeperateItem(Boolean(settingsData?.show_upselling_item_as_seperate_item)));
      localStorage.setItem(
        "showUpsellItemsInMenu",
        String(Boolean(settingsData?.show_upsell_items_in_menu))
      );

      // TODO(P4): media conversion → setMediaData/setMediaItems/banner slots
      // TODO(P8): getDeploymentInfoApi + fetchPaymentSettings + Geidea/NeoLeap sockets
      // TODO(P6): make-it-a-meal primary/secondary texts
      // TODO(P7): recommendations prefetch

      //// Loyalty partner (P7c) — posistKiosk useLoaders.ts:633-646, with one
      // deliberate divergence: the fork runs this block AFTER its boot
      // try/catch closes, so a dead loyalty proxy rejects `unwrap()` with
      // nobody listening (unhandled promise rejection on an unattended
      // kiosk). Here it sits INSIDE the try, so the same failure surfaces on
      // the boot error screen with its retry instead — Rule 2.
      // `setLoyaltyPartner` also flips state.loyalty.isLoyaltyOn, which is
      // why every gate reads getIsLoyaltyOn() (enable_loyalty AND a resolved
      // partner) rather than the raw selector.
      if (settingsData?.enable_loyalty) {
        const loyaltyPartner = await getLoyaltyPartner({
          deployment_id: deploymentDetails?._id,
        }).unwrap();
        if (loyaltyPartner) {
          dispatch(setLoyaltyPartner(loyaltyPartner));
        }
      }

      successCallback();
    } catch (error) {
      const err = error as { message?: string } | null | undefined;
      errorCallback(err?.message ?? "Error in Loading Resources");
    }
  };

  return { LoadResourcesInitially };
}

export default useLoaders;
