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
  orderSlice,
  customerInfo,
  pipelineSlice,
  themeSlice,
  multiLanguageSlice,
  timerSlice,
  errorSlice,
  loyaltySlice,
  makeItAMealSlice,
  dynamicPricingSlice,
  autoUpdateSlice,
  recommendationSlice,
  kioskOpenStatusSlice,
  filterSlice,
  offerSessionSlice,
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
 * A slice with no entry here and no neverPersist listing is persisted IN
 * FULL — so every registered slice must have one or the other.
 *
 * The old KNOWN LEAK, resolved 2026-10-07 (audit-fixes C3): paymentInfo,
 * messageModals, appImage and tableSummary are no longer registered in TB's
 * store (0 dispatchers, 0 readers; the SDK paymentInfo.slice stays for the
 * fork); kioskOpenStatus persists through an explicit manifest
 * (pipelinesStatuses — the bag's order-type switch reads it after a
 * crash-reload); the dead whitelist fields auth.userNumber / selectedTabId and
 * payment.PlutusTransactionReferenceID / paymentInfo / paymentSetting /
 * paytmMid / parkedOrderId / paymentLinkId / isMashReqConnected /
 * dojoSessionInfo are no longer persisted — TB ports no Pine Labs, Dojo,
 * Razorpay or Mashreq gateway, so none carries crash-recovery semantics here.
 * The fork's store is untouched; its P3e deferral stands for the fork.
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
        // The guest's country pick (UB5) lasts one guest — the session reset
        // restores IN/+91 — but survives a crash-reload mid-order.
        "selectedCountryCode",
        "tab_id",
        "deploymentDetails",
        "licenseDetails",
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
        // Boot-derived (enable_dis_addon) and read by the order, offer and
        // cart discount math. A relaunch (or P9e's whole-app reload) reaches
        // /start without booting, so an unpersisted flag fell back to false.
        "discountOnAddon",
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
    // Persisted ON PURPOSE (lane "offers", decision 4): a crash-reload keeps
    // the Dexie cart and the persisted cartOffer, so the auto-apply latch must
    // survive too — otherwise an offer the customer removed would be
    // re-applied after the reload. Stuck, the worst case is no auto-apply.
    // Cleared only by resetSession (both scopes) and RESET_STATE.
    {
      slice: "offerSession",
      scope: "customer",
      whitelist: ["autoApplyOptOut", "autoAppliedOfferId"],
    },
    {
      slice: "payment",
      scope: "customer",
      whitelist: [
        // The Paytm resume set (readOpenPaytmSession): a reload mid-payment
        // settles by status with the SAME ids. "paytmSecretKey" is
        // deliberately NOT persisted (P3, Rule 3): a merchant credential.
        "posBillNo",
        "posBillTime",
        "paymentType",
        "paytmQrCode",
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
    {
      slice: "multiLanguage",
      whitelist: ["primary_language", "secondary_language", "selectedLanguage"],
    },
    { slice: "offer", whitelist: ["offers"] },
    { slice: "order", whitelist: ["orderId", "orderStatus", "appliedCharges"] },
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
        // P9e (D1, TB-only): the boot-age stamp must survive reloads — a
        // relaunch with a token goes straight to /start and never boots.
        "lastBootAt",
        // Also the failure stamp: a failed brand/operator refresh on fresh
        // data is retried 30 min later (msUntilScheduledRefresh), and a
        // deploy reload or power cycle inside that window must not drop the
        // retry until the 6 h age. Loop-safe: the backoff survives too.
        "lastRefreshFailedAt",
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
    // Per-pipeline open/closed statuses, its only field (same bytes on disk
    // as before C3). Read after a crash-reload: the bag's order-type switch
    // offers a target pipeline by them, and only /second re-fetches them.
    {
      slice: "kioskOpenStatus",
      scope: "customer",
      whitelist: ["pipelinesStatuses"],
    },
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
    customerInfo: customerInfo,
    pipeline: pipelineSlice,
    theme: themeSlice,
    multiLanguage: multiLanguageSlice,
    timer: timerSlice,
    makeItAMeal: makeItAMealSlice,
    errorInfo: errorSlice,
    loyalty: loyaltySlice,
    dynamicPricing: dynamicPricingSlice,
    autoUpdate: autoUpdateSlice,
    recommendation: recommendationSlice,
    kioskOpenStatus: kioskOpenStatusSlice,
    filter: filterSlice,
    offerSession: offerSessionSlice,
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
  // The SDK leaves this to the shell: never in production (CX-23).
  devTools: import.meta.env.DEV,
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
