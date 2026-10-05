import {
  createKioskStore,
  type PersistencePolicy,
} from "@cx-sdk/core";
import { storageSideEffects } from "./storageSideEffects";
import {
  authSlice,
  menuSelections,
  cartSlice,
  paymentSlice,
  offerSlice,
  paymentInfoSlice,
  orderSlice,
  customerInfo,
  appImageSlice,
  tableSummarySlice,
  pipelineSlice,
  themeSlice,
  multiLanguageSlice,
  timerSlice,
  errorSlice,
  loyaltySlice,
  makeItAMealSlice,
  dynamicPricingSlice,
  autoUpdateSlice,
  messageModalsSlice,
  recommendationSlice,
  kioskOpenStatusSlice,
  filterSlice,
} from "../features";
import { apiSlice } from "./apiSlice";
// "…/es/storage" (real ESM), not "…/lib/storage" (CJS): under Vite 8/Rolldown
// the CJS default-import interop hands back the module namespace and
// redux-persist crashes with "storage.getItem is not a function".
import storage from "redux-persist/es/storage";
import menuSlice from "@cx-sdk/catalog/state/Menu.slice";
import appSettingsSlice from "@cx-sdk/catalog/state/appSettings.slice";

/**
 * The kiosk's persistence policy, expressed as the @cx-sdk/core manifest
 * (P3e). This is a 1:1 transcription of the legacy createFilter list — same
 * slices, same fields, same order — so behavior is identical by construction.
 * As slices migrate into @cx-sdk packages, their entries move with them.
 *
 * KNOWN LEAK (preserved, do not fix silently): paymentInfo, messageModals and
 * kioskOpenStatus have no entry and are not blacklisted, so redux-persist
 * persists them IN FULL — flagged for a maintainer decision alongside
 * PlutusTransactionReferenceID/dojoSessionInfo.
 */
const persistence: PersistencePolicy = {
  neverPersist: ["api", "errorInfo", "menu", "menuSelections"],
  manifests: [
    { slice: "filter", whitelist: ["filters"] },
    {
      slice: "auth",
      scope: "device",
      whitelist: [
        "token",
        "selectedCountryCode",
        "tab_id",
        "userNumber",
        "deploymentDetails",
        "licenseDetails",
        "selectedTabId",
      ],
    },
    {
      slice: "appSettings",
      scope: "device",
      whitelist: [
        "paymentSettings",
        "kiosk_settings",
        "mediaData",
        "mediaDataConverted",
        "mediaItems",
        "bannerItemsAvailable",
        "generalSettings",
        "currencySettings",
        "country",
        "tent",
        "deploymentInfoSettings",
        "coverImage",
        "deploymentName",
        "logo",
        "charges",
        "countries",
        "disableCODKiosk",
        "idealTimeout",
        "clusterSettings",
        "showSelectionText",
        "changeContrast",
        "oneCategoryAtATime",
        "quickCustomizationMode",
        "enableFullWidthBanner",
        "enableAccessibilityMode",
        "templateType",
        "skipPhoneAndName",
        "hideFilter",
        "mandatoryFullscreen",
        "stickyDuration",
        "hideComboConstituentAddons",
        "show_upselling_item_as_seperate_item",
        "hide_plus_icon_from_item",
        "auto_adjust_font_size",
        "showRepeatCustomization",
        "enableBannerCollapes",
      ],
    },
    {
      slice: "customerInfo",
      scope: "customer",
      whitelist: ["customerInfo", "customerName", "customerPhone"],
    },
    {
      slice: "loyalty",
      scope: "customer",
      whitelist: [
        "isLoyaltyOn",
        "areCouponsAvailable",
        "totalLoyaltyPoints",
        "totalRedeemablePoints",
        "minBillForRedemption",
        "loyaltyPartner",
        "coupons",
        "loyaltyItems",
        "redeemedLoyalty",
      ],
    },
    // DO NOT add "cartUpsellSeen" or "cartUpsellEntryQuantity" here. Both are
    // scoped to one CUSTOMER, not one device — persisting them would carry a
    // stuck flag (permanently suppressing the pre-cart upsell on that machine)
    // and a stale entry baseline (mis-colouring the button for the next
    // customer) across a kiosk reboot.
    {
      slice: "cart",
      scope: "customer",
      whitelist: [
        "netAmount",
        "cartOffer",
        "instructions",
        "charges",
        "maxCartQuantity",
        "menuCharges",
        "deploymentCharges",
      ],
    },
    {
      slice: "payment",
      scope: "customer",
      whitelist: [
        "posBillNo",
        "posBillTime",
        "PlutusTransactionReferenceID",
        "paymentInfo",
        "paymentSetting",
        "paymentType",
        "paytmQrCode",
        "paytmMid",
        // "paytmSecretKey" is deliberately NOT persisted (P3): it is a
        // merchant credential that was sitting in plaintext localStorage
        // (Rule 3). It is re-fetched with payment settings each session.
        // PlutusTransactionReferenceID and dojoSessionInfo stay persisted
        // pending maintainer sign-off — they may carry crash-recovery
        // semantics for in-flight terminal transactions.
        "parkedOrderId",
        "paymentLinkId",
        "isMashReqConnected",
        "dojoSessionInfo",
      ],
    },
    {
      slice: "dynamicPricing",
      whitelist: [
        "isDynamicPricingEnabled",
        "dpItemsMap",
        "validDpSessions",
        "currentSession",
      ],
    },
    { slice: "tableSummary", whitelist: ["netAmount"] },
    {
      slice: "multiLanguage",
      whitelist: ["primary_language", "secondary_language", "selectedLanguage"],
    },
    { slice: "offer", whitelist: ["offers"] },
    { slice: "order", whitelist: ["orderId", "orderStatus", "appliedCharges"] },
    { slice: "appImage", whitelist: ["appImages"] },
    {
      slice: "pipeline",
      whitelist: ["pipelines", "selectedPipeline", "tabType"],
    },
    { slice: "theme", whitelist: ["themeData", "grid_wise_enabled"] },
    { slice: "timer", whitelist: ["timeRemaining"] },
    {
      slice: "autoUpdate",
      scope: "device",
      whitelist: [
        "fcmKey",
        "lastUpdatedTime",
        "currentUpdateStatus",
        "shouldBrandUpdate",
        "device_update_id",
        "shouldRegisterFCM",
        "kioskDeviceVersion",
      ],
    },
    {
      slice: "makeItAMeal",
      whitelist: [
        "primaryMakeItAMealText",
        "secondaryMakeItAMealText",
        "mappedItemWithCombos",
      ],
    },
    { slice: "recommendation", whitelist: [] },
  ],
};

const handle = createKioskStore({
  reducers: {
    auth: authSlice,
    menu: menuSlice,
    cart: cartSlice,
    payment: paymentSlice,
    offer: offerSlice,
    appSettings: appSettingsSlice,
    order: orderSlice,
    menuSelections: menuSelections,
    paymentInfo: paymentInfoSlice,
    customerInfo: customerInfo,
    appImage: appImageSlice,
    tableSummary: tableSummarySlice,
    pipeline: pipelineSlice,
    theme: themeSlice,
    multiLanguage: multiLanguageSlice,
    timer: timerSlice,
    makeItAMeal: makeItAMealSlice,
    errorInfo: errorSlice,
    loyalty: loyaltySlice,
    dynamicPricing: dynamicPricingSlice,
    messageModals: messageModalsSlice,
    autoUpdate: autoUpdateSlice,
    recommendation: recommendationSlice,
    kioskOpenStatus: kioskOpenStatusSlice,
    filter: filterSlice,
    [apiSlice.reducerPath]: apiSlice.reducer,
  },
  persistence,
  // The web shell's storage engine. React Native will pass an AsyncStorage/
  // MMKV adapter here instead — core never touches a storage API directly.
  storage,
  middleware: {
    // Runs the localStorage side effects that used to live inside reducers
    // (P3a) — synchronously after each matched reducer, same dispatch.
    prepend: [storageSideEffects.middleware],
    concat: [apiSlice.middleware],
  },
  devTools: true,
});

export const store = handle.store;
export const persistor = handle.persistor;

// Dev-only escape hatch so the store can be inspected from the browser
// console / CDP while debugging on a real device or dev server. Stripped
// from production builds by the DEV guard.
if (import.meta.env.DEV) {
  (window as unknown as { __kioskStore?: typeof store }).__kioskStore = store;
}

// Function to reset persisted state and clear storage
export const resetPersistedState = () => {
  persistor.purge();
  store.dispatch({ type: "RESET_STATE" }); // Optionally dispatch a reset action
};
