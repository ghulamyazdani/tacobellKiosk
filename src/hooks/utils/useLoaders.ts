/* eslint-disable no-restricted-globals --
 * The raw localStorage writes below are FORK PARITY: posistKiosk mirrors a
 * few kiosk settings into localStorage for legacy warm-boot fallbacks. They
 * fold into the persistence manifest in a later phase.
 */
import type { UnknownAction } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import {
  selectDeploymentDetails,
  selectLicenseDetails,
} from "@cx-sdk/core/auth/authentication.slice";
import { setLastBootAt } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { setPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import {
  useFetchCXPipelinesMutation,
  useGetKioskMediaMutation,
  useGetKioskSettingsMutation,
  useGetLanguageMutation,
} from "@cx-sdk/catalog/services/kioskInfoApi";
import { pickHomeScreenMedia } from "@cx-sdk/catalog/media/splashMedia";
import { useGetCxSkinDataMutation } from "@cx-sdk/catalog/services/settingsApi";
import { useGetLoyaltyPartnerMutation } from "@cx-sdk/ordering/services/loyaltyApi";
import {
  setLoyaltyPartner,
  turnOfLoyalty,
} from "@cx-sdk/ordering/state/loyalty.slice";
import {
  setPrimaryMakeItAMealText,
  setSecondaryMakeItAMealText,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  setAutoAdjustFontSize,
  setEnableAccessibilityMode,
  setEnableBannerCollapse,
  setEnableFullWidthBanner,
  setGeneralSettings,
  setHideComboConstituentAddons,
  setHideFilter,
  setHidePlusIconFromItem,
  setIdealTimeout,
  setKioskSettings,
  setMediaData,
  setOneCategoryAtATime,
  setPaymentSettings,
  setQuickCustomizationMode,
  setShowRepeatCustomization,
  setShowSelectionText,
  setShowUpsellingItemAsSeperateItem,
  setStickyDuration,
  setTemplateType,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  filterPaymentOptions,
  findMashreqPartner,
  type Entity,
} from "@cx-sdk/payments/gateways/paymentOptions";
import { useGetPaymentSettingsApiMutation } from "@cx-sdk/payments/services/paymentSettingsFetchApi";
import { useGetDeploymentPaymentPartnersMutation } from "@cx-sdk/payments/services/paymentInfoApi";
import { setLanguages } from "../../redux/features/multiLanguage/multiLanguage.slice";
import useAppSettings from "./useAppSettings";
import useFetchColors from "./colorManagement/useFetchColors";
import useTenantRecommendations from "../recommendation/useTenantRecommendations";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/** The registration blob the two settings fetches are keyed on. */
interface LicenseDetails {
  deployment_id?: string;
  license_key?: string;
}

/** `getDeploymentPaymentPartners` response — only the fields we read. */
interface DeploymentPaymentPartners {
  paymentPartners?: { _id?: string; partner_name?: string }[];
}

/** Awaited trigger result of the untyped `getPaymentSettingsApi` mutation. */
interface DeviceSettingsResult {
  data?: unknown;
}

/** Collects a boot write for the single commit at the end of a boot (P9e). */
type Stage = (action: UnknownAction) => void;

/**
 * Why boot stopped — /LoadingResources picks its translated copy from this.
 * The config reasons are fixed in Cockpit; "unavailable" is everything else
 * (network, timeout, 5xx, malformed body), which only waiting can fix.
 */
export type BootFailure =
  | "unavailable"
  | "noLanguage"
  | "noPipelines"
  | "noStartText";

/** A boot stop caused by the kiosk's configuration, not the network. */
class BootConfigError extends Error {
  readonly reason: Exclude<BootFailure, "unavailable">;

  constructor(reason: Exclude<BootFailure, "unavailable">) {
    super(reason);
    this.reason = reason;
  }
}

/** Analytics detail for a failed call: RTK errors carry {status, error}, thrown Errors a message. */
const errorDetail = (error: unknown) => {
  const cause = error as
    | { status?: unknown; error?: unknown; message?: unknown }
    | null
    | undefined;
  return {
    error_status: String(cause?.status ?? "none"),
    error_detail: String(cause?.error ?? cause?.message ?? ""),
  };
};

/**
 * Fork-parity mirror write (nothing in TB reads these keys back). Best
 * effort: a full or blocked localStorage is a local fault, so it must not stop
 * boot as "Can't connect" and retry forever.
 */
const mirrorSetting = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    captureKioskEvent(KioskEventName.ErrorOccurred, {
      source: "boot_storage",
      ...errorDetail(error),
    });
  }
};

/**
 * P3 boot loader — posistKiosk's LoadResourcesInitially in the SAME ORDER:
 *   language → skin → pipelines → theme → splash media → kiosk settings
 *   (+ MIAM texts) → deployment info → payment settings → loyalty partner
 *   → commit → tenant recommendations (background) → success
 * Splash media landed in P9d (home_screen only); menu banners are not built
 * (user decision 2026-10-06). Post-P9: the MIAM texts (29c) are staged with
 * the kiosk settings; the tenant recommendations refresh (29b) starts only
 * after the commit, as a background task, never a staged step. Cluster
 * settings are dead in the fork (posistKiosk useLoaders.ts:649-657 is
 * commented out), so there is nothing to port.
 *
 * P8a added deployment info + payment settings and NOTHING ELSE. In the fork
 * those two fetches are immediately followed by `connectTOGeideaSocket(...)`
 * and `connectWithNeoLeapSocket(...)` (posistKiosk useLoaders.ts:585-589),
 * which open ws://localhost:5000 and ws://localhost:7000 at boot. Those two
 * calls are deliberately NOT ported: their absence is what makes this build
 * peripheral-free by construction, not by configuration. Do not add them
 * here when the card flow lands — they belong behind that phase's own gate.
 *
 * Any 401 inside this sequence triggers the transport's onAuthFailure
 * (sessionRecovery.recoverFromAuthFailure): token cleared, RESET_STATE,
 * redirect to Registration — THE stale-device logout path.
 */
function useLoaders() {
  const dispatch = useDispatch();
  const deploymentDetails = useSelector(selectDeploymentDetails);
  const licenseDetailsRdx = useSelector(selectLicenseDetails) as
    | LicenseDetails
    | string
    | null
    | undefined;
  const { FetchThemeData } = useFetchColors();
  const { getDeploymentInfoApi, getAllIds } = useAppSettings();
  const { refresh: refreshTenantRecommendations } = useTenantRecommendations();

  const [getLanguageFromApi] = useGetLanguageMutation();
  const [getCxSkinData] = useGetCxSkinDataMutation();
  const [fetchCXPipelines] = useFetchCXPipelinesMutation();
  const [getKioskSettings] = useGetKioskSettingsMutation();
  const [getKioskMedia] = useGetKioskMediaMutation();
  const [getLoyaltyPartner] = useGetLoyaltyPartnerMutation();
  const [getPaymentSettingsApi] = useGetPaymentSettingsApiMutation();
  const [getDeploymentPaymentPartnersApi] =
    useGetDeploymentPaymentPartnersMutation();

  /**
   * P9d splash media — posistKiosk useLoaders.ts:283-432, made decorative.
   * The fork threw into the boot catch on a rejected or hung call, on a
   * missing MENU banner ("No Primary Banner Media Found") and on an empty
   * map, so a promo problem stopped the kiosk booting. This step never
   * throws, and the transport's 10 s budget bounds it. Any failure keeps the
   * last-known media (appSettings.mediaData is device-persisted): the splash
   * shows what it showed before, or the WELCOME frame if nothing was stored.
   * A valid body without home_screen stores [] (the operator removed it).
   * The write is staged, so it is stored only if the whole boot succeeds.
   *
   * ONLY `{ media: { home_screen } }` is stored: menu banners are not built
   * (user decision 2026-10-06). The SDK's banner walk is guarded since
   * post-P9 25a (getMediaUrl, the converter walk, clearMediaDataConvertedItems),
   * so a stored banner_image_* key can no longer blank /menu.
   */
  const loadSplashMedia = async (stage: Stage): Promise<void> => {
    try {
      const body: unknown = await getKioskMedia({
        brand_id: deploymentDetails?.brand_id,
      }).unwrap();
      const homeScreen = pickHomeScreenMedia(body, deploymentDetails?._id);
      if (!homeScreen) throw new Error("getMedia body has no media list");
      stage(setMediaData({ media: { home_screen: homeScreen } }));
    } catch (error) {
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        source: "boot_media_fetch",
        ...errorDetail(error),
      });
    }
  };

  /**
   * P8a boot fetch — the device-settings half of posistKiosk's
   * `usePaymentHook.fetchPaymentSettings` (usePaymentHook.ts:273-336),
   * reimplemented here because TB has no usePaymentHook and is not getting
   * one in this phase.
   *
   * What it does: POST /api/cx/getKisokDeviceData (the backend's typo) +
   * POST /api/cx/kiosk/getDeploymentPaymentPartners, split the entities with
   * the SDK's `filterPaymentOptions`, and store both halves. The GENERAL half
   * is the load-bearing one for P8a: `generalSettingsRdx` is what
   * useAppSettings reads for `print_bill`, `enable_printing_via_pos`, the
   * printer name/IP and the `tent_number_range` the /tent screen validates
   * against. The payment half only populates the (currently unreachable)
   * gateway tile list.
   *
   * DELIBERATELY DROPPED from the fork's version:
   * - The Mashreq branch. The fork calls `connectToMashreq()` here, which
   *   opens the https://localhost:5000/EFTTransact terminal bridge during
   *   boot. Not ported. Beyond that, `filterPaymentOptions` PREPENDS a
   *   synthetic "Mashreq" payment option whenever the deployment carries that
   *   partner, so the row is stripped below: in a pay-at-counter-only build a
   *   terminal option must not exist even as data.
   * - `console.error` on failure — replaced by a structured analytics event.
   *
   * Best-effort by design (Rule 2): none of it is required to place a
   * pay-at-counter order, so a settings blip must not turn into a kiosk that
   * refuses to boot. A failed or malformed fetch stages nothing (P9e B4), so
   * the last good settings stand; on a device that never booted those are
   * the slice defaults (no printing, an unconfigured tent step, no gateways).
   */
  const fetchPaymentSettings = async (stage: Stage): Promise<void> => {
    try {
      // Fork parity: the persisted blob is sometimes the literal string
      // "undefined", hence the fork's `!== "undefined"` guard.
      const license: LicenseDetails =
        licenseDetailsRdx && typeof licenseDetailsRdx === "object"
          ? licenseDetailsRdx
          : {};

      const deviceSettings: DeviceSettingsResult = await getPaymentSettingsApi({
        deployment_id: license?.deployment_id,
        license_key: license?.license_key,
      });
      // Not unwrapped, so a failure resolves `{error}`, and an error envelope
      // is not a list either. Storing [] for those dropped the tent range and
      // the printer config on every blip, successful boots included (B4).
      // `filterPaymentOptions` also needs a list (it calls `entities?.forEach`).
      if (!Array.isArray(deviceSettings?.data)) {
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          source: "boot_payment_settings_fetch",
        });
        return;
      }

      // A partner-list failure must not cost us the general settings above,
      // so it is caught separately. No partners simply means no synthetic
      // gateway rows — exactly the P8a steady state.
      let partners: DeploymentPaymentPartners | undefined;
      try {
        const partnersResult: unknown = await getDeploymentPaymentPartnersApi({
          deployment_id: license?.deployment_id ?? "",
        }).unwrap();
        partners = partnersResult as DeploymentPaymentPartners | undefined;
      } catch {
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          source: "boot_payment_partners_fetch",
        });
      }

      const { validPaymentOptions, generalSettings } = filterPaymentOptions(
        deviceSettings.data as Entity[],
        partners,
        getAllIds
      );

      // SAFETY: drop the synthetic Mashreq row (see the note above).
      const mashreqPartner = findMashreqPartner(partners);
      const paymentOptions = mashreqPartner
        ? validPaymentOptions.filter(
            (option) => option?._id !== mashreqPartner?._id
          )
        : validPaymentOptions;

      stage(setPaymentSettings(paymentOptions));
      stage(setGeneralSettings(generalSettings));
    } catch {
      // Structured error path — no console in shipped code.
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        source: "boot_payment_settings_fetch",
      });
    }
  };

  /**
   * P9e STAGE → COMMIT. Every step STAGES its writes; nothing reaches the
   * store until every step has run. Then one synchronous burst after the
   * last await commits them in step order and stamps `lastBootAt`. So a boot
   * that fails anywhere commits NOTHING: a splash refresh (D1) returns on
   * exactly the old data, and a first boot retries from a clean slate. The
   * values a half-run boot used to leave (empty pipelines B1, a degraded
   * kiosk_settings B2) can never be stored. Best-effort steps stage only a
   * well-formed success and otherwise keep the last-known value (B3/B4).
   * The theme is the one write outside the commit (see its step).
   */
  const LoadResourcesInitially = async (
    errorCallback: (failure: BootFailure) => void,
    successCallback: () => void
  ) => {
    const staged: UnknownAction[] = [];
    const stage: Stage = (action) => {
      staged.push(action);
    };
    try {
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
          throw new BootConfigError("noLanguage");
        }
        stage(setLanguages(languageData));
      } else {
        throw new BootConfigError("noLanguage");
      }

      //// Skin (fork parity; Taco Bell renders its own shell regardless).
      // Not unwrapped: only an answer replaces the stored skin (a failed call
      // used to overwrite it with "default").
      const skinCx = await getCxSkinData({ app: "Kiosk", channel: "Kiosk" });
      if (skinCx && "data" in skinCx) {
        stage(
          setTemplateType(skinCx.data?.skin_id === "skin_2" ? "albaik" : "default")
        );
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
      stage(setPipelines(availableData));
      if (availableData?.length === 0) {
        throw new BootConfigError("noPipelines");
      }

      //// Theme → --brand-* CSS variables. Not awaited (fork parity), but no
      // longer a floating rejection either: the theme is cosmetic, and the
      // --brand-* fallbacks in index.css stand when it fails.
      // The ONE write outside the commit (P9e): it lands whenever the call
      // answers, so it can arrive after a boot that then failed. Accepted:
      // what it writes is a valid theme; no TB screen renders a brand-*
      // utility (only index.css defines them); grid_wise only shapes the PDP
      // grid; and its CSS variables are DOM, not redux, so they could not be
      // staged anyway. Awaiting it to stage it would slow every boot.
      void FetchThemeData().catch((error: unknown) =>
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          source: "boot_theme_fetch",
          ...errorDetail(error),
        })
      );

      //// Splash media (fork position). Staged with the rest, so /start mounts
      // with this boot's media already stored; it cannot reject.
      await loadSplashMedia(stage);

      //// Kiosk settings (verbatim decision block from the fork)
      const settingsData = await getKioskSettings({
        brand_id: deploymentDetails?.brand_id,
        tenant_id: deploymentDetails?.tenant_id,
        channel: "Kiosk",
      }).unwrap();

      stage(setOneCategoryAtATime(Boolean(settingsData?.one_category_at_a_time)));
      stage(setShowRepeatCustomization(!settingsData?.remove_repeat_customization_modal));
      stage(setQuickCustomizationMode(Boolean(settingsData?.quick_customization_mode)));
      // Booleans only: a null/garbage value keeps the persisted gate (fork
      // semantics for null) instead of hiding the ADA toggle.
      if (typeof settingsData?.accessibility_mode === "boolean") {
        stage(setEnableAccessibilityMode(settingsData.accessibility_mode));
      }
      stage(setEnableFullWidthBanner(Boolean(settingsData?.full_width_banner)));
      stage(setHideFilter(Boolean(settingsData?.hide_filter)));
      stage(setHideComboConstituentAddons(Boolean(settingsData?.hide_combo_constituent_add_ons)));
      const showSelectionText = settingsData?.show_selection_text_in_customization === true;
      stage(setShowSelectionText(showSelectionText));
      stage(setKioskSettings(settingsData));
      stage(setEnableBannerCollapse(Boolean(settingsData?.enable_banner_collapes)));

      if (!settingsData?.start_order_text_primary) {
        throw new BootConfigError("noStartText");
      }
      if (isSecondarySet && !settingsData?.start_order_text_secondary) {
        throw new BootConfigError("noStartText");
      }
      // Degrade over block (Rule 2): this used to throw (fork parity), so a
      // missing ideal_time parked boot on the retry screen. Absent, the slice
      // value stands — resolveIdleSeconds() caps it at Rule 1's 120 s anyway.
      if (settingsData?.ideal_time) {
        stage(setIdealTimeout(parseInt(settingsData.ideal_time, 10)));
      }
      if (
        settingsData?.proximity_sensor_camera_detection_delay &&
        settingsData.proximity_sensor_camera_detection_delay > 0
      ) {
        stage(
          setStickyDuration(
            parseInt(settingsData.proximity_sensor_camera_detection_delay) * 1000
          )
        );
      } else {
        stage(setStickyDuration(10000));
      }
      stage(setHidePlusIconFromItem(settingsData?.hide_plus_icon_from_item !== false));
      stage(setAutoAdjustFontSize(Boolean(settingsData?.auto_adjust_font_size)));
      stage(setShowUpsellingItemAsSeperateItem(Boolean(settingsData?.show_upselling_item_as_seperate_item)));
      // Post-P9 29c: the operator's MIAM headline per language slot. ALWAYS
      // staged ("" when unset) so the prompt falls back to the translated
      // miam.title — the slice's built-in default is an English string that
      // never let it. No localStorage mirror (fork): nothing in TB reads one.
      // `as never`: the SDK reducers take `action: any`, which RTK types as a
      // creator whose parameter is never; the payload is a plain string.
      const miamText = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      stage(setPrimaryMakeItAMealText(miamText(settingsData?.make_it_meal_primary) as never));
      stage(setSecondaryMakeItAMealText(miamText(settingsData?.make_it_meal_secondary) as never));

      //// Deployment ordering settings (P8a) — populates
      // appSettings.deploymentInfoSettings, which is the ONLY input to
      // checkIfCODAvailable() on /payment. Awaited (the fork fires and
      // forgets) so /payment can never render its tile list from a blob that
      // is still in flight. It cannot reject: getDeploymentInfoApi reads
      // `res.data` off the trigger result instead of unwrapping, and a failed
      // or malformed fetch stages nothing, so the stored rows stand (P9e B3).
      // On a device that never booted that is the `[]` default: the FAIL-OPEN
      // direction — with no "Disable COD for Kiosk" entity found,
      // checkIfCODAvailable returns true and PAY AT COUNTER stays reachable,
      // which is the behaviour a pay-at-counter-only build wants.
      await getDeploymentInfoApi(stage);

      //// Device/payment settings (P8a) — general half feeds print_bill,
      // enable_printing_via_pos, the printer name/IP and tent_number_range;
      // payment half feeds the gateway option list. Best-effort: see the
      // function's doc comment. NO socket connectors follow this call.
      await fetchPaymentSettings(stage);

      //// Loyalty partner (P7c) — posistKiosk useLoaders.ts:633-646. The fork
      // runs this AFTER its boot try/catch closes, so a dead loyalty proxy is
      // an unhandled rejection there. P9b, user decision 2026-10-01: DEGRADE,
      // never block — a loyalty outage must not stop the kiosk selling. Boot
      // finishes loyalty-OFF (no /phone, no rewards UI), the Activity Center
      // shows "loyalty unavailable", and StartScreen retries the lookup on
      // each splash visit (a relaunch never re-runs this boot).
      // `isLoyaltyOn` is persisted, so it is cleared FIRST: left alone, the
      // last boot's `true` would keep loyalty on for a partner this boot never
      // confirmed. `setLoyaltyPartner` flips it back on, which is why every
      // gate reads getIsLoyaltyOn() (enable_loyalty AND a resolved partner)
      // rather than the raw selector. The session reset keeps both fields
      // (resetLoyaltySession), so this stays boot-scoped.
      if (settingsData?.enable_loyalty) {
        stage(turnOfLoyalty());
        try {
          const loyaltyPartner = await getLoyaltyPartner({
            deployment_id: deploymentDetails?._id,
          }).unwrap();
          if (loyaltyPartner) {
            stage(setLoyaltyPartner(loyaltyPartner));
          }
        } catch (error) {
          captureKioskEvent(KioskEventName.ErrorOccurred, {
            source: "loyalty_partner",
            ...errorDetail(error),
          });
        }
      }

      //// COMMIT: the last await is behind us; one synchronous burst.
      // No Dexie wipe here (the fork's boot ran resetDatabase first): with D1
      // a boot runs ≥ 4×/day, and each wipe cost the next guest the full
      // menu download. A cached menu is reused only on the server's 304 for
      // that same menu id, /start's mount clears the cart rows, the tenant
      // recommendations copy is device data that only a good answer
      // replaces (below), and registration, logout and the 401 recovery
      // still wipe everything.
      staged.forEach((action) => dispatch(action));
      // D1: the boot age the splash's scheduled refresh reads. Stamped only
      // here, so only a fully successful boot of any kind counts.
      dispatch(setLastBootAt(Date.now()));
      // Fork-parity mirrors, written only for a committed boot.
      mirrorSetting("showSelectionText", String(showSelectionText));
      mirrorSetting("kiosk_settings", JSON.stringify(settingsData));
      mirrorSetting(
        "showUpsellItemsInMenu",
        String(Boolean(settingsData?.show_upsell_items_in_menu))
      );
      // Post-P9 29b: the tenant recommendations, a post-commit BACKGROUND
      // task — never awaited (a dead S3 can never delay or fail a boot), never
      // run for a failed boot (it sits after the commit), and it never
      // rejects. Only the bag rail's suggestions change when it lands.
      void refreshTenantRecommendations();

      successCallback();
    } catch (error) {
      // Config problems name their reason; anything else (an RTK rejection
      // has no `.message` — {status, error} only) is "unavailable".
      const failure: BootFailure =
        error instanceof BootConfigError ? error.reason : "unavailable";
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        source: "boot",
        failure,
        ...errorDetail(error),
      });
      errorCallback(failure);
    }
  };

  return { LoadResourcesInitially };
}

export default useLoaders;
