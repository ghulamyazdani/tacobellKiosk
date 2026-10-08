/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useAppSettings wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
import React from "react";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  setChargesCountryData,
  setInitialAppSetting,
  setDiscountOnAddon,
  selectDiscountOnAddon,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { useDispatch, useSelector, useStore } from "react-redux";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { useGetDeploymentInfoForOrderingMutation } from "@cx-sdk/catalog/services/settingsApi";
import { setDeploymentInfo } from "@cx-sdk/catalog/state/appSettings.slice";
import { useGetChargesCountryDataMutation } from "@cx-sdk/catalog/services/qrInfoApi";
import CountryCodes from "@cx-sdk/core/data/CountryCodes";

import {
  pushCharges,
  selectMenuCharges,
  setDeploymentCharges,
} from "@cx-sdk/ordering/state/cart.slice";
import { composeBillCharges } from "@cx-sdk/catalog/menu/billCharges";

import { selectOngoingOrders } from "@cx-sdk/ordering/state/order.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { selectSelectedLanguage } from "../../redux/features/multiLanguage/multiLanguage.slice";
import { setCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import {
  kiosSettingsRdx,
  generalSettingsRdx,
} from "@cx-sdk/catalog/state/appSettings.slice";

import { isLoyaltyOn } from "@cx-sdk/ordering/state/loyalty.slice";
import { selectTabId } from "@cx-sdk/core/auth/authentication.slice";
import { selectSelectedPipeline } from "@cx-sdk/catalog/state/pipeline.slice";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
import { selectTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import {
  setIsDeploymentDynamicPricingEnabled,
  setIsDynamicPricingEnabled,
} from "@cx-sdk/catalog/state/dynamicPricing.slice";
import RiyalLogo from "../../components/RiyalLogo";
import * as settingsEngine from "@cx-sdk/catalog/settings/settingsEngine";

/** The one auth field the default-country guard reads at response time (UB5). */
interface CountryPickState {
  auth?: { selectedCountryCode?: { picked?: unknown } | null };
}

/**
 * Thin wrapper over @cx-sdk/catalog/settings/settingsEngine.
 * The pure derivations live in the SDK; this hook only gathers inputs
 * (selectors), performs side effects (dispatch, RTK Query, localStorage
 * mirrors, document.body) and renders React elements (RiyalLogo).
 */
function useAppSettings() {
  const dispatch = useDispatch();
  // Live reads after an await (never a render-time closure).
  const store = useStore();
  const kiosSettings = useSelector(kiosSettingsRdx);
  const selectSelectedPipelineRdx = useSelector(selectSelectedPipeline);
  const tabId = useSelector(selectTabId);
  const deploymentDetailsRdx = useSelector(selectDeploymentDetails);
  const selectTabTypeRdx = useSelector(selectTabType);
  const currencyRdx = useSelector(selectCurrency);
  const generalSettings = useSelector(generalSettingsRdx);
  const [getDeploymentInfo] = useGetDeploymentInfoForOrderingMutation();
  const selectOngoingOrdersRdx = useSelector(selectOngoingOrders);
  const selectSelectedLanguageRdx = useSelector(selectSelectedLanguage);
  const isLoyaltyOnRdx = useSelector(isLoyaltyOn);
  const language = selectSelectedLanguageRdx?.code || "en";
  const discountOnAddonRdx = useSelector(selectDiscountOnAddon);

  const [getChargesCountryApi] = useGetChargesCountryDataMutation();

  const syncAppSettings = () => {
    // document.title = "QR Menu";
    document.body.style.overflow = "hidden";

    dispatch(setInitialAppSetting({}));
  };

  const getCurrency = () => {
    if (settingsEngine.isSarCurrency(currencyRdx)) {
      return React.createElement(RiyalLogo);
    }
    return settingsEngine.getCurrencyText(currencyRdx);
  };

  const getCurrencyCode = () => {
    return settingsEngine.getCurrencyCode(currencyRdx);
  };

  /**
   * Deployment ordering settings. `apply` defaults to dispatch; the boot
   * passes its stage, so the writes land in its one commit (P9e).
   */
  const getDeploymentInfoApi = async (
    apply: (action: UnknownAction) => unknown = dispatch
  ) => {
    const deployment_id = deploymentDetailsRdx ? deploymentDetailsRdx?._id : "";
    const res = await getDeploymentInfo({ deployment_id });
    // Only a real list of setting rows replaces the stored one (P9e B3). A
    // failed call or a degraded body (`{}`, an error envelope) keeps the last
    // good rows: storing [] silently dropped `disable_roundoff` (bill totals
    // changed) and the "Disable COD" gate until the next good boot, even
    // when the boot itself succeeded.
    //
    // The slice must ALWAYS hold an array (P8a): the SDK's
    // `hasSetting(name, settingsArray)` (ordering/order/orderBuilder) does an
    // UNGUARDED `settingsArray.filter`, reached from `convertOrderItems` →
    // `convertCart` → `getCalculatedBill`, i.e. on EVERY bill recompute while
    // the bag is open. The SDK derive helper also iterates with `forEach`.
    if (!Array.isArray(res.data)) return;
    // Replays the SDK-derived setting updates in the same order/count as the
    // original inline loop.
    settingsEngine
      .deriveDeploymentSettingUpdates(res.data)
      .forEach((update) => {
        if (update.kind === "dynamicPricing") {
          apply(setIsDynamicPricingEnabled(update.selected));
        }
        if (update.kind === "deploymentDynamicPricing") {
          apply(setIsDeploymentDynamicPricingEnabled(update.selected));
        }
        if (update.kind === "discountOnAddon") {
          apply(setDiscountOnAddon(update.selected));
        }
      });
    apply(setDeploymentInfo(res.data));
  };

  const valueWrapper = (value: any) => {
    return settingsEngine.valueWrapper(value);
  };

  const calculationWrapper = (value: any) => {
    return settingsEngine.calculationWrapper(value);
  };

  /**
   * Charges + country + currency for a tab. With `opts` (the in-bag
   * order-type switch) every dispatch goes to `apply` and every localStorage
   * write to `mirror`, so nothing lands until the caller commits; without
   * it, today's writes byte-for-byte. Resolves `ok` (a body arrived) and the
   * filtered deployment charges.
   */
  const getChargesCountryDataApi = async (
    tabId: any,
    opts?: {
      apply?: (action: UnknownAction) => unknown;
      mirror?: (key: string, value: string) => void;
    },
  ): Promise<{ ok: boolean; deploymentCharges: unknown[] }> => {
    const apply = opts?.apply ?? dispatch;
    const mirror =
      opts?.mirror ??
      ((key: string, value: string) => window.localStorage.setItem(key, value));
    const tab_id = getTabId();
    const deployment_id = deploymentDetailsRdx ? deploymentDetailsRdx?._id : "";

    const res: any = await getChargesCountryApi({
      isCharged: true,
      isCountry: true,
      isSettings: true,
      isCurrency: true,
      deployment_id: deployment_id, // required if isCharged is true or if isCurrency is true
      tab_id: tabId || tab_id, // required if isCharged is true
    });
    let deploymentCharges: unknown[] = [];
    if (res?.data) {
      const data = res?.data;
      apply(
        setChargesCountryData({
          charges: settingsEngine.filterCharges(data?.charges),
          countries: CountryCodes,
        }),
      );

      const defaultCountry = settingsEngine.resolveDefaultCountry(
        data?.deployment?.countryCode,
        CountryCodes,
      );
      // UB5: the deployment default never overwrites a guest's country pick.
      // The staged order-type switch (`opts`) never re-applies it (same
      // deployment, same default), and the live /second call — not awaited,
      // so it can land after a pick on the pre-menu /phone — checks for a
      // pick when its response arrives. A pick (`picked: true`, written only
      // by the country picker) lasts one guest: the session reset clears it.
      const picked = (store.getState() as CountryPickState).auth
        ?.selectedCountryCode?.picked;
      if (defaultCountry && !opts && !picked) {
        apply(setCountryCode(defaultCountry));
      }

      apply(setCurrency(data?.deployment?.currencySettings));
      //setting the charges and country Data

      if (data?.charges) {
        const filteredCharges = settingsEngine.filterCharges(data?.charges);
        // C1b: the menu charges are read back from redux (setMenuCharges is
        // dispatched beside its localStorage mirror), never from raw
        // localStorage — a logout purge clears redux but not the mirror.
        // Menu FIRST here (this site's historical order).
        const allCharges = composeBillCharges(
          filteredCharges,
          selectMenuCharges(store.getState()),
          true,
        );
        apply(setDeploymentCharges(filteredCharges));
        mirror("deploymentCharges", JSON.stringify(filteredCharges));
        mirror("charges", JSON.stringify(allCharges));
        apply(pushCharges(allCharges));
        deploymentCharges = filteredCharges;
      }
      mirror("countries", JSON.stringify(CountryCodes));
    }
    return { ok: !!res?.data, deploymentCharges };
  };

  const getTabType = () => {
    return settingsEngine.getTabType(selectTabTypeRdx);
  };

  const getTabId = () => {
    return settingsEngine.getTabId(tabId);
  };

  const getScannedInfo = () => {
    return {};
  };

  const moduloCalcaledValue = (value: any) => {
    return settingsEngine.moduloCalcaledValue(value);
  };

  function generateRandomString(length: any) {
    return settingsEngine.generateRandomString(length);
  }

  const checkIfOfferWillBeDisabled = () => {
    return settingsEngine.checkIfOfferWillBeDisabled(
      getTabType(),
      selectOngoingOrdersRdx,
    );
  };

  const getMediaUrl = (mediaType: any, parsedMediaData: any) => {
    return settingsEngine.getMediaUrl(mediaType, parsedMediaData);
  };

  function deepParseJSON(data: any) {
    return settingsEngine.deepParseJSON(data);
  }

  // `type` is optional: with it omitted (or anything but TITLE/DESCRIPTION)
  // every branch falls through and the call returns undefined, which callers
  // like OfferItemCustomization rely on via `|| fallback`.
  const getTranslated = (entity: any, type?: any) => {
    return settingsEngine.getTranslated(language, entity, type);
  };

  const getIsLoyaltyOn = () => {
    return settingsEngine.getIsLoyaltyOn(kiosSettings, isLoyaltyOnRdx);
  };

  const getSuperCategoryOnlySetting = () => {
    return settingsEngine.getSuperCategoryOnlySetting(kiosSettings);
  };

  const shouldSkipCRM = () => {
    return settingsEngine.shouldSkipCRM(kiosSettings);
  };

  const getIsPayAtCounter = (): boolean => {
    return settingsEngine.getIsPayAtCounter(kiosSettings);
  };

  const getAllIds = () => {
    return settingsEngine.getAllIds(
      deploymentDetailsRdx,
      selectSelectedPipelineRdx,
    );
  };

  const getSelectedPipeline = () => {
    return settingsEngine.getSelectedPipeline(selectSelectedPipelineRdx);
  };

  const formatTime = (seconds: any) => {
    return settingsEngine.formatTime(seconds);
  };

  const getPrintBillSetting = () => {
    return settingsEngine.getPrintBillSetting(generalSettings);
  };

  const getPrinterName = () => {
    return settingsEngine.getPrinterName(generalSettings);
  };

  const getPrinterIp = () => {
    return settingsEngine.getPrinterIp(generalSettings);
  };

  const getIsPrintOnPos = () => {
    return settingsEngine.getIsPrintOnPos(generalSettings);
  };

  const getDeactivatedPipelines = () => {
    return settingsEngine.getDeactivatedPipelines(generalSettings);
  };

  const getMappedItemsLength = (mappedItemsObj: any, subItemEntities: any) => {
    return settingsEngine.getMappedItemsLength(mappedItemsObj, subItemEntities);
  };

  const getAmountBasedItemValue = (item: any) => {
    return settingsEngine.getAmountBasedItemValue(item, discountOnAddonRdx);
  };

  return {
    getTabType,
    getTabId,
    getScannedInfo,
    syncAppSettings,
    getCurrency,
    getCurrencyCode,
    getDeploymentInfoApi,
    valueWrapper,
    getChargesCountryDataApi,
    checkIfOfferWillBeDisabled,
    calculationWrapper,
    moduloCalcaledValue,
    getMediaUrl,
    getTranslated,
    deepParseJSON,
    generateRandomString,
    getIsLoyaltyOn,
    getSuperCategoryOnlySetting,
    getAllIds,
    formatTime,
    getPrintBillSetting,
    getPrinterName,
    getPrinterIp,
    getIsPrintOnPos,
    getDeactivatedPipelines,
    getSelectedPipeline,
    getAmountBasedItemValue,
    shouldSkipCRM,
    getIsPayAtCounter,
    getMappedItemsLength,
  };
}

export default useAppSettings;
