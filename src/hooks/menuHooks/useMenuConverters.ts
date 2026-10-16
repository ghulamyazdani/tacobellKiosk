/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useMenuConverters wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
/**
 * THIN WRAPPER (P5) — the pure conversion logic of this hook now lives in
 * @cx-sdk/catalog/menu/legacyMenuConverters. This file keeps: all redux
 * wiring (useSelector/dispatch), RTK-Query calls, the Dexie db.menus 304
 * fallback, every localStorage site, and the local loading state. Same
 * exported API, same observable behavior.
 */
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { freeze, type UnknownAction } from "@reduxjs/toolkit";
import {
  selectMenu,
  setMenuData,
  setTags,
  setEntpShowCategory,
  selectEntpShowCategory,
  setModifiersMap,
  selectModifierMap,
  setEntityMenuObject,
  setVariantObject,
  setAllMenuWithoutChecks,
  setSubCategoryMap,
  setEntityModifierMap,
  selectEntityModifierMap,
  setMenuBasedOnCategory,
  setSubCategoryMapWhichContainsTopLevelCategoryIdAndName,
  setEntityMap,
  setCategoryMap,
  selectVariantEntityMap,
} from "@cx-sdk/catalog/state/Menu.slice";
import {
  setFilters,
  selectFilters,
} from "@cx-sdk/catalog/state/filter.slice";

import useOfferHook from "../offerHooks/useOfferHook";
import { filterEntitiesByTags } from "@cx-sdk/catalog/menu/menuUtils";
import { useGetOutOfStockMutation } from "@cx-sdk/catalog/services/outOfStockApi";

import { useGetMenuMutation } from "@cx-sdk/catalog/services/menuApi";
import {
  selectMappedUpsellIds,
  setMappedUpsellIds,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  selectDeploymentDetails,
  selectLicenseDetails,
} from "@cx-sdk/core/auth/authentication.slice";
import {
  mediaDataRdx,
  mediaItemsRdx,
  selectOneCategoryAtATime,
  selectShowUpsellingItemAsSeperateItem,
  setAllowMultiplePunch,
  setBannerAvailableItems,
  setMediaDataConverted,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  pushCharges,
  selectDeploymentCharges,
  setMenuCharges,
} from "@cx-sdk/ordering/state/cart.slice";
import { composeBillCharges } from "@cx-sdk/catalog/menu/billCharges";
import useAppSettings from "../utils/useAppSettings";
import { selectSelectedLanguage } from "../../redux/features/multiLanguage/multiLanguage.slice";
import { kiosSettingsRdx } from "@cx-sdk/catalog/state/appSettings.slice";
import { selectTabId } from "@cx-sdk/core/auth/authentication.slice";
import useSchedulerConverter from "../schedulerHooks/useSchedulerConverter";
import { selectDpItemsMap } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { useLazyGetServerTimeQuery } from "@cx-sdk/catalog/services/settingsApi";
import moment from "dayjs";
import useOfferConverters from "../offerHooks/useOfferConverters";
import { db } from "../../models/db";
import {
  selectIsDynamicPricingEnabled,
  setDpItemsMap,
} from "@cx-sdk/catalog/state/dynamicPricing.slice";
import useDynamicPricing from "../dynamicPricingHooks/useDynamicPricing";
import useAllowMultiplePunch from "../customization/useAllowMultiplePunch";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import {
  buildLegacyCategoryMaps,
  buildLegacyMenuWithChecks,
  buildLegacyModifierMap,
  collectLegacyEntityMaps,
  collectLegacyInactiveMaps,
  computeLegacyOneCategoryPayloads,
  convertLegacyMenuCharges,
  convertLegacyMenuTree,
  filterLegacyMenuByTags,
  isCheckBoxRequiredFunction as legacyIsCheckBoxRequiredFunction,
  isStepperRequired as legacyIsStepperRequired,
  mapItemToCombos as legacyMapItemToCombos,
  mergeLegacyMediaItemMap,
  resolveLegacyModifierGroups,
  type LegacyComboData,
  type LegacyComboEntity,
} from "@cx-sdk/catalog/menu/legacyMenuConverters";

/*
  Perf pass BOOT-1: Immer's autoFreeze deep-walks every payload a reducer
  stores and stops only at an object already frozen. All of them together
  are ~69k objects of the reference menu (~12 ms on an M-class dev machine,
  several times that on the kiosk CPU, per pipeline tap — measured
  2026-10-16). Production freezes each root before its dispatch (Immer's
  shallow freeze); DEV keeps the deep freeze as the mutation tripwire. Every
  menu-scale root fetchMenu dispatches goes through this: one left out is
  walked with everything it reaches — the menu tree ~63k objects,
  modifiersMap ~53k, an entity map ~7k (the roots share their objects).
  ponytail: production leaves the objects INSIDE the menu maps unfrozen — a
  mutation bug no DEV suite reaches edits this guest's menu instead of
  throwing (each fetchMenu rebuilds it from a fresh copy).
*/
const frozenRoot = <T>(value: T): T => (import.meta.env.DEV ? value : freeze(value));

/**
 * The ONE modifier-group resolver (UB6): the SDK keeps the fork's trailing
 * `undefined` per id the menu's `modifiers` lacks; this drops them, so no
 * caller reads a field off one. Pure — useCustomization uses it without
 * instantiating this hook (perf pass PDP-2).
 */
export const resolveModifierGroups = (modifiersMap: unknown, modifiersToBeSearched: Array<string>) =>
  resolveLegacyModifierGroups(modifiersMap, modifiersToBeSearched, (value) =>
    structuredClone(value),
  )?.filter(Boolean);

function useMenuConverters() {
  const dispatch = useDispatch();
  // Store handle, not a subscription: fetchMenu reads the deployment charges
  // back after its awaits (C1b).
  const store = useStore();
  const selectFiltersRdx = useSelector(selectFilters);
  const isDynamicPricingEnabled = useSelector(selectIsDynamicPricingEnabled);
  // Verbatim parity: the original bound `selectTabIdRdx` (read only by the
  // deleted dead fetchOutOfStock). The bare call keeps the subscription.
  useSelector(selectTabId);
  const kiosSettings = useSelector(kiosSettingsRdx);
  useSelector(selectVariantEntityMap);
  const { fetchDpSessions, fetchDpItems } = useDynamicPricing();
  const showEntpCategory = useSelector(selectEntpShowCategory);
  const mediaItemsMapRdx = useSelector(mediaItemsRdx);
  const parsedMediaItems = useSelector(mediaDataRdx);
  const licenseDetails = useSelector(selectLicenseDetails);
  const { isValidAsPerSchedulers } = useSchedulerConverter();
  const { converOffersForGetItemByMenu } = useOfferConverters();
  const dpItemsMapRdx = useSelector(selectDpItemsMap);
  const [getServerTimeApi] = useLazyGetServerTimeQuery();
  const selectModifiersRdx = useSelector(selectModifierMap);
  // The entity->modifier-groups map this hook itself dispatches via
  // setEntityModifierMap; fetchModifierPropertiesAll reads it back.
  const entityModifiersMapRdx = useSelector(selectEntityModifierMap);
  const menuData = useSelector(selectMenu);
  const [fetchLoading, setFetchLoading] = useState(false);
  // fetchMenu's late-result guard (see there).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Delegates to the leaf hook so this one-liner has a single implementation
  // and components needing only this boolean can skip this hook entirely.
  const { isAllowMultiplePunch } = useAllowMultiplePunch();
  const [getMenuApi, { isLoading }] = useGetMenuMutation();
  const selectDeploymentDetailsRdx = useSelector(selectDeploymentDetails);
  const language = useSelector(selectSelectedLanguage);
  const oneCategoryAtATimeRdx = useSelector(selectOneCategoryAtATime);
  useSelector(selectMappedUpsellIds);
  const selectShowUpsellingItemAsSeperateItemRdx = useSelector(
    selectShowUpsellingItemAsSeperateItem,
  );

  const { getCxOffers } = useOfferHook();

  const [getOutOfStock] = useGetOutOfStockMutation();
  const {
    getMediaUrl,
    getTabType,
    getSelectedPipeline,
    getSuperCategoryOnlySetting,
  } = useAppSettings();
  const showOnlySupCat = getSuperCategoryOnlySetting();

  const [menuLocal, setMenuLocal] = useState<any>("");

  // The host clone the SDK's pure functions use wherever the hook used
  // structuredClone (the SDK compiles without host globals).
  const deepClone = (value: any) => structuredClone(value);

  const convertMenuCharges = (
    charges: any,
    taxesMap: any,
    pipeline: any,
    tabTypeOverride?: unknown,
  ) => {
    // Same guards as the SDK function so the app-side getters below are only
    // invoked on the exact paths the original invoked them on.
    if (!charges) {
      return [];
    }
    // MONEY: the tab type of the pipeline being fetched (fetchMenu passes
    // `pipeline?.tab_type`). /second dispatches setTabType and calls fetchMenu
    // in the same tick, so the render-time getter still held the PREVIOUS
    // session's type — only "table" changes the result, so a guest after a
    // table session lost the menu charges (and the reverse applied them).
    // The getter remains the fallback for a caller without a pipeline row
    // (BagSheet's fetchMenu(tab, true, false, true)). Diverges from the fork,
    // which keeps the stale closure.
    const tabType = tabTypeOverride ?? getTabType();
    if (tabType === "table") {
      return [];
    }
    const selectedPipeline = pipeline ? pipeline : getSelectedPipeline();
    return convertLegacyMenuCharges(charges, taxesMap, tabType, selectedPipeline);
  };

  //function to filter the menu
  const filterMenu = (tags: string[]) => {
    setFetchLoading(true);
    if (tags?.length === 0) {
      setMenuLocal(menuData || {});
      setFetchLoading(false);
      return;
    }
    const newMenuData = filterLegacyMenuByTags(
      menuData,
      tags,
      showEntpCategory,
      deepClone,
    );
    setMenuLocal(newMenuData);
    setMenuLocal(newMenuData);
    dispatch(setFilters(tags));
  };


  /**
   * `opts` = STAGED mode (the in-bag order-type switch): every dispatch goes
   * to `apply` and every localStorage write to `mirror` (the dp, offer and
   * converter internals included); `deploymentCharges` come from opts, never
   * localStorage; menu charges use `pipeline.tab_type`; `requireOffers` turns
   * an offers-fetch failure into `{}` (D1b). Only the Dexie menu-cache put
   * happens before the caller commits. No opts = today's writes, byte-for-byte.
   */
  const fetchMenu = async (
    tab_id: any,
    checkRedux: boolean,
    shouldReRunConverters?: boolean,
    pipeline?: any,
    opts?: {
      apply?: (action: UnknownAction) => unknown;
      mirror?: (key: string, value: string) => void;
      deploymentCharges?: unknown[];
      requireOffers?: boolean;
    },
  ) => {
    const apply = opts?.apply ?? dispatch;
    const mirror =
      opts?.mirror ??
      ((key: string, value: string) => window.localStorage.setItem(key, value));
    // loading state for fetching the menu
    setFetchLoading(true);

    if (checkRedux) {
      if (menuData && Object.keys(menuData).length > 0) {
        setMenuLocal(menuData);
        setFetchLoading(false);
        if (!shouldReRunConverters) return;
      }
    }

    try {
      const parsedLicenceDetails = licenseDetails;
      let currentServerDateWithTime = moment();
      let dpItemsMap = {};

      if (!isDynamicPricingEnabled) {
        apply(setDpItemsMap({}));
        // FORK PARITY: posistKiosk mirrors dpItemsMap into localStorage for
        // legacy warm-boot fallbacks; folds into the persistence manifest later.
        mirror("dpItemsMap", JSON.stringify({}));
      }

      // Initiate both API calls in parallel
      //
      // ⚠️ This is the only branch whose `menu` is NOT freshly JSON-parsed from
      // the wire or from Dexie. menuRenderingChecks no longer deep-clones its
      // inputs (see the contract at the top of that file), so if this branch is
      // ever made live, verify nothing downstream relies on the JSON
      // normalisation the removed clones used to apply (undefined keys dropped,
      // NaN -> null). It is dead today: no call site passes a truthy 3rd
      // argument — though Cart.tsx:1127 has a stray `true` in slot 4 (pipeline),
      // which is one finger-slip from slot 3.
      // Hoisted from the two branches below: these were function-scoped
      // `var` declarations; TARGET bans `var`, so they are declared once here
      // and assigned per-branch (no behavior change).
      let menu: any;
      let outOfStock: any;
      let serverTimeData: any;
      let offers: any;
      let validDpSessions: any;
      if (shouldReRunConverters) {
        menu = structuredClone(menuData);

        [outOfStock, serverTimeData, offers, validDpSessions] =
          await Promise.all([
            getOutOfStock({
              deployment_id: parsedLicenceDetails.deployment_id,
              tab_id: tab_id,
            }).unwrap(),
            getServerTimeApi({}).unwrap(),
            getCxOffers(pipeline.tab_type, apply).catch(() => null),
            isDynamicPricingEnabled
              ? fetchDpSessions(apply).catch(() => [])
              : Promise.resolve([]),
          ]);
        dpItemsMap = await fetchDpItems(pipeline?._id, validDpSessions, apply);
      } else {
        // Perf pass BOOT-2: the four calls that do not need the cached menu
        // id start BEFORE the Dexie read (the whole ~7 MB row), so they
        // overlap it; only getMenu waits for the id. The bare catch only
        // keeps a rejection that lands during the read from being reported
        // as unhandled — the Promise.all below still observes it (→ {}).
        const rest = Promise.all([
          getOutOfStock({
            deployment_id: parsedLicenceDetails.deployment_id,
            tab_id: tab_id,
          }).unwrap(),
          getServerTimeApi({}).unwrap(),
          getCxOffers(pipeline.tab_type, apply).catch(() => null),
          isDynamicPricingEnabled
            ? fetchDpSessions(apply).catch(() => [])
            : Promise.resolve([]),
        ]);
        rest.catch(() => {});

        let storedMenuId = "";
        let storedMenuFull: any = null;

        try {
          const storedMenuRecord = await db?.menus?.get(tab_id);
          if (storedMenuRecord) {
            storedMenuFull = storedMenuRecord;
            storedMenuId = storedMenuRecord.menuId || "";
          }
        } catch {
          // Best effort: no cached menu id → a full download (C5: no log).
        }

        [menu, [outOfStock, serverTimeData, offers, validDpSessions]] =
          await Promise.all([
            getMenuApi({
              tab_id: tab_id,
              cluster_id: selectDeploymentDetailsRdx.cluster_id,
              deployment_id: selectDeploymentDetailsRdx._id,
              MENU_ID: storedMenuId,
            }).unwrap(),
            rest,
          ]);
        dpItemsMap = await fetchDpItems(pipeline?._id, validDpSessions, apply);

        if (
          menu?.status === 304 ||
          menu?.status === "304" ||
          menu?.statusCode === 304 ||
          menu?.statusCode === "304"
        ) {
          if (storedMenuFull && storedMenuFull.menu) {
            menu = storedMenuFull.menu;
          }
        } else {
          if (menu?.MENU_ID) {
            // Perf pass BOOT-4: not awaited — a ~7 MB IndexedDB commit is
            // not the guest's wait. IndexedDB queues the next read behind
            // this write; a lost write costs one full download, as a failed
            // put always has. The try covers a synchronous throw.
            try {
              void db.menus
                .put({
                  tabId: tab_id,
                  menuId: menu.MENU_ID,
                  menu: menu,
                })
                .catch(() => {});
            } catch {
              // Best effort: the next fetch downloads it again (C5: no log).
            }
            // One macrotask boundary before the conversion. Un-awaited, the
            // write's structured clone (IndexedDB copies the menu as put()
            // runs) and the conversion below ran as ONE frame — ~450 ms at
            // 6x CPU on the reference menu, vs ~250 + ~150 ms while the
            // commit was awaited (perf benchmark, 2026-10-16). The yield
            // splits them without waiting for the commit.
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      }

      // Rule 3 (P9a): idle can end the session under the awaits above (the
      // fetch overlay hides every other exit). Once the caller is gone, a
      // late menu must not overwrite the NEXT customer's — drop it like a
      // failed fetch.
      // ponytail: guards only this function's own writes; fetchDpItems still
      // writes the dp map after its own await. With P9b's host-configured
      // transport budget (getMenu 30 s) the fetch normally settles before
      // idle can fire, so this is the backstop.
      if (!mountedRef.current) return {};
      // D1b: a switch never commits a pipeline whose offers it could not load.
      if (opts?.requireOffers && offers == null) {
        setFetchLoading(false);
        return {};
      }

      if (
        menu.settings &&
        menu.settings.allow_multiple_punch &&
        menu.settings.allow_multiple_punch == true
      ) {
        apply(setAllowMultiplePunch(true));
      } else {
        apply(setAllowMultiplePunch(false));
      }

      const categoryMap = new Map<any, any>();

      if (menu?.settings?.send_categories === true) {
        apply(setEntpShowCategory({ entpShowCategory: true }));
        mirror("entpShowCategory", "true");
      } else {
        apply(setEntpShowCategory({ entpShowCategory: false }));
        mirror("entpShowCategory", "false");
      }
      if (serverTimeData && serverTimeData.serverTime) {
        const currentServerDate = new Date(serverTimeData.serverTime);
        currentServerDateWithTime = moment(currentServerDate);
      }

      // Staged: a DP failure prices regular (D1c) — never the CURRENT pipeline's map.
      const dpItemsMapToUse = dpItemsMap || (opts ? {} : dpItemsMapRdx);

      const variantEntityMap = new Map<any, any>();
      const entityMapAfterConversion = new Map<any, any>();

      const menuWithChecks = buildLegacyMenuWithChecks({
        menu,
        outOfStock,
        showNoImageItem: kiosSettings.show_no_image_item,
        dpItemsMapToUse,
        currentServerDateWithTime,
        isValidAsPerSchedulers,
      });

      const {
        entityMap,
        variantAndBaseItemMapping,
        activeVariantEntityMap,
        entityObject,
      } = collectLegacyEntityMaps(
        menuWithChecks,
        categoryMap,
        variantEntityMap,
        entityMapAfterConversion,
      );

      const taxesMap = new Map<any, any>();

      const entityMapObject = Object.fromEntries(entityMap);
      apply(setEntityMap({ entityMap: frozenRoot(entityMapObject) }));

      const convertedData = convertMenuData(
        menuWithChecks,
        outOfStock,
        menu.settings?.send_categories,
        dpItemsMapToUse,
        currentServerDateWithTime,
        taxesMap,
        categoryMap,
        activeVariantEntityMap,
        entityMap,
        apply,
      );

      const modifierMap = buildLegacyModifierMap(convertedData.modifiers);

      apply(
        setModifiersMap({
          modifiersMap: frozenRoot(modifierMap),
        }),
      );

      if (oneCategoryAtATimeRdx) {
        computeLegacyOneCategoryPayloads(
          convertedData,
          showOnlySupCat,
          showEntpCategory,
        ).forEach((payload: any) => {
          apply(setMenuBasedOnCategory({ ...payload, menu: frozenRoot(payload.menu) }));
        });

        const {
          inActiveVariantMap,
          inActiveEntityMap,
          subCategoryMap,
          categoryMapData,
          entityWithModifiersMap,
          subCategoryMapWhichContainsTopLevelCategoryIdAndName,
        } = buildLegacyCategoryMaps(
          convertedData,
          modifierMap,
          outOfStock,
          deepClone,
        );

        apply(
          setEntityModifierMap({
            entityAndModifierMap: frozenRoot(entityWithModifiersMap),
          }),
        );

        apply(
          setCategoryMap({
            categoryMap: frozenRoot(categoryMapData),
          }),
        );

        apply(
          setSubCategoryMap({
            subCategoryMap: frozenRoot(subCategoryMap),
          }),
        );
        apply(
          setSubCategoryMapWhichContainsTopLevelCategoryIdAndName({
            subCategoryMapWhichContainsTopLevelCategoryIdAndName: frozenRoot(
              subCategoryMapWhichContainsTopLevelCategoryIdAndName,
            ),
          }),
        );

        apply(
          setAllMenuWithoutChecks({
            inActiveEntities: frozenRoot(inActiveEntityMap),
            inaActiveVariants: frozenRoot(inActiveVariantMap),
          }),
        );
        //dispatching the variant
        apply(
          setEntityMenuObject({
            menuEntityObject: frozenRoot(entityObject),
          }),
        );
        apply(
          setVariantObject({
            variantObject: frozenRoot(variantAndBaseItemMapping),
          }),
        );
      } else {
        const { inActiveEntityMap, inActiveVariantMap } =
          collectLegacyInactiveMaps(menu, outOfStock);

        apply(
          setAllMenuWithoutChecks({
            inActiveEntities: frozenRoot(inActiveEntityMap),
            inaActiveVariants: frozenRoot(inActiveVariantMap),
          }),
        );
        //dispatching the variant
        apply(
          setEntityMenuObject({
            menuEntityObject: frozenRoot(entityObject),
          }),
        );
        apply(
          setVariantObject({
            variantObject: frozenRoot(variantAndBaseItemMapping),
          }),
        );
      }

      // C1b: the deployment charges come from opts (staged) or back from
      // redux (setDeploymentCharges is dispatched beside its localStorage
      // mirror), never from raw localStorage. Deployment FIRST here.
      const deploymentCharges =
        opts?.deploymentCharges ?? selectDeploymentCharges(store.getState());

      const menuCharges = convertMenuCharges(
        menu.charges,
        taxesMap,
        pipeline,
        pipeline?.tab_type,
      );
      const allCharges = composeBillCharges(deploymentCharges, menuCharges);

      apply(pushCharges(allCharges));
      apply(setMenuCharges({ menuCharges: menuCharges }));
      mirror("menuCharges", JSON.stringify(menuCharges));
      mirror("charges", JSON.stringify(allCharges));

      converOffersForGetItemByMenu(
        entityMapAfterConversion,
        categoryMap,
        variantEntityMap,
        fetchModifierProperties,
        offers,
        apply,
      );

      setMenuLocal(convertedData);

      apply(setMenuData({ menu: frozenRoot(convertedData) }));
      //now create a map for modifiers and there ids

      setFetchLoading(false);
      return convertedData;
    } catch (err: any) {
      // Every failure (network, timeout, 5xx, 401/504/505 after their side
      // effects, bad body, converter bug) lands here and resolves {} — fork
      // parity, and BagSheet relies on the shape. Callers judge the returned
      // categories (SecondLayout / Menu show the menu-error dialog); the cause
      // goes to analytics, the only trace of it on an unattended kiosk.
      // error_detail keeps RTK's "TimeoutError…", which is how a mid-body
      // timeout (PARSING_ERROR under RTK 2.12) is told apart from a bad body.
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        error_source: "menu_fetch",
        error_status: String(err?.status ?? err?.name ?? "unknown"),
        error_detail: String(err?.error ?? err?.message ?? ""),
      });
      setFetchLoading(false);
      return {};
    }
  };

  const convertMenuData = (
    menu: any,
    outOfStockItems: any,
    entpShowCategory: any,
    dpItemsMap: any,
    currentServerDateWithTime: any,
    taxesMap: any,
    categoryMap: any,
    activeVariantMap: any,
    entityMap?: any,
    apply: (action: UnknownAction) => unknown = dispatch,
  ) => {
    try {
      const mappedUpsellIds: any = {};
      // Deep-clone ONLY what conversion walks and rebuilds: categories.
      //
      // This used to be JSON.parse(JSON.stringify(menu)) over the whole payload.
      // On the reference menu (9 categories / 12 sub-categories / 122 entities)
      // `modifiers` is 6,831 KB of a 7,549 KB payload — 90.5% — and conversion
      // reads exactly two fields from it, `_id` and `isActive`, through the two
      // .find() calls in convertLegacySubCategoryData. So it is passed by
      // reference. Measured: full round-trip 18.05 ms vs categories-only
      // 1.75 ms, and peak transient allocation drops from ~24 MB to ~3 MB.
      //
      // JSON round-trip rather than structuredClone on purpose: it is faster
      // here (1.75 vs 2.12 ms) AND it preserves the normalisation the converted
      // menu has always had — undefined keys dropped, NaN -> null.
      const menuItems = {
        ...menu,
        categories: JSON.parse(JSON.stringify(menu.categories)),
      };
      //get the media items
      const newParsedMediaItems = [] as any;
      //get the mediaitems
      const mediaItemMapLocal = {} as any;
      getMediaUrl(
        language.type === "secondary_language" ? "secondary" : "primary",
        parsedMediaItems,
      )?.forEach((entity: any) => {
        if (!mediaItemMapLocal[entity.uniqueId]) {
          mediaItemMapLocal[entity.uniqueId] = [];
        }
      });

      const deepCopyMediaItemsMapRdx = { ...mediaItemsMapRdx };

      const availableItems = [] as any;
      const availableItemsMap = new Set();
      const showNoImageItem = kiosSettings.show_no_image_item;
      const schedulerMap: any = new Map();
      const tags = new Set();

      const newMenuItems = convertLegacyMenuTree({
        menuItems,
        entpShowCategory,
        showNoImageItem,
        parsedMediaItems,
        languageType: language.type,
        outOfStockItems,
        availableItems,
        availableItemsMap,
        deepCopyMediaItemsMapRdx,
        newParsedMediaItems,
        mediaItemMapLocal,
        entityMap,
        dpItemsMap,
        currentServerDateWithTime,
        schedulerMap,
        taxesMap,
        tags,
        categoryMap,
        mappedUpsellIds,
        activeVariantMap,
        hideVegNonVeg: kiosSettings?.hide_veg_non_veg,
        deepClone,
      });

      //setting in the redux
      apply(setBannerAvailableItems(availableItems));

      if (selectShowUpsellingItemAsSeperateItemRdx) {
        apply(setMappedUpsellIds({}));
      } else {
        apply(setMappedUpsellIds(mappedUpsellIds));
      }

      const deepCopyParsedMedia = mergeLegacyMediaItemMap(
        parsedMediaItems,
        language.type,
        mediaItemMapLocal,
      );

      //now setting this as final converted data

      if (tags?.size > 0) {
        apply(setTags({ tags: Array.from(tags) }));
      }

      apply(setMediaDataConverted(deepCopyParsedMedia));

      return newMenuItems;
    } catch {
      // Returns undefined; fetchMenu's next read of the result then throws
      // into its catch (analytics + {} → the menu-error dialog). C5: no log.
    }
  };

  function isCheckBoxRequiredFunction(min: any, max: any) {
    return legacyIsCheckBoxRequiredFunction(min, max);
  }

  //global function to fetch all the modifier groups and there items if it is not variant
  // Drops ids the menu's `modifiers` lacks: the SDK resolver keeps the fork's
  // trailing-`undefined` quirk, and the PDP seed read `group._id` off one
  // (UB6 — the crash screen from the bag rail). One implementation:
  // resolveModifierGroups (module scope), which useCustomization shares.
  const fetchModifierProperties = (modifiersToBeSearched: Array<string>) =>
    resolveModifierGroups(selectModifiersRdx, modifiersToBeSearched);

  const fetchModifierPropertiesAll = (
    _modifiersToBeSearched: Array<string>,
    entityId: any,
  ) => {
    return !entityId ? [] : entityModifiersMapRdx[entityId] || [];
  };

  function mapItemToCombos(
    data: LegacyComboData,
  ): Record<string, LegacyComboEntity[]> {
    return legacyMapItemToCombos(data);
  }

  // Delegates to the pure `filterEntitiesByTags` in menuUtils so this and the
  // leaf-selector `useTagFilter` hook can never drift. Behaviour unchanged —
  // including the `undefined`-in / `undefined`-out contract that
  // isUpsellEnabledOnItem depends on.
  const filterByTags = (items: string[]) =>
    filterEntitiesByTags(selectFiltersRdx, items);
  const isStepperRequired = (maxItem: any) => legacyIsStepperRequired(maxItem);

  return {
    menuData: menuLocal,
    fetchMenu,
    filterMenu,
    isMenuLoading: isLoading || fetchLoading,
    isCheckBoxRequiredFunction,
    fetchModifierProperties,
    mapItemToCombos,
    isAllowMultiplePunch,
    filterByTags,
    fetchModifierPropertiesAll,
    isStepperRequired,
  };
}

export default useMenuConverters;
