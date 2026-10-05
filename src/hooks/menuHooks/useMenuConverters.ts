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
import { useDispatch, useSelector } from "react-redux";
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
  setMenuCharges,
} from "@cx-sdk/ordering/state/cart.slice";
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
  addOutOfStockField as legacyAddOutOfStockField,
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

function useMenuConverters() {
  const dispatch = useDispatch();
  const selectFiltersRdx = useSelector(selectFilters);
  const isDynamicPricingEnabled = useSelector(selectIsDynamicPricingEnabled);
  const selectTabIdRdx = useSelector(selectTabId);
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

  const convertMenuCharges = (charges: any, taxesMap: any, pipeline: any) => {
    // Same guards as the SDK function so the app-side getters below are only
    // invoked on the exact paths the original invoked them on.
    if (!charges) {
      return [];
    }
    const tabType = getTabType();
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


  const fetchMenu = async (
    tab_id: any,
    checkRedux: boolean,
    shouldReRunConverters?: boolean,
    pipeline?: any,
  ) => {
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
        dispatch(setDpItemsMap({}));
        // FORK PARITY: posistKiosk mirrors dpItemsMap into localStorage for
        // legacy warm-boot fallbacks; folds into the persistence manifest later.
        // eslint-disable-next-line no-restricted-globals
        localStorage.setItem("dpItemsMap", JSON.stringify({}));
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
            getCxOffers(pipeline.tab_type).catch(() => null),
            isDynamicPricingEnabled
              ? fetchDpSessions().catch(() => [])
              : Promise.resolve([]),
          ]);
        dpItemsMap = await fetchDpItems(pipeline?._id, validDpSessions);
      } else {
        let storedMenuId = "";
        let storedMenuFull: any = null;

        try {
          const storedMenuRecord = await db?.menus?.get(tab_id);
          if (storedMenuRecord) {
            storedMenuFull = storedMenuRecord;
            storedMenuId = storedMenuRecord.menuId || "";
          }
        } catch (error) {
          console.error("Error fetching menu from DB", error);
        }

        [menu, outOfStock, serverTimeData, offers, validDpSessions] =
          await Promise.all([
            getMenuApi({
              tab_id: tab_id,
              cluster_id: selectDeploymentDetailsRdx.cluster_id,
              deployment_id: selectDeploymentDetailsRdx._id,
              MENU_ID: storedMenuId,
            }).unwrap(),
            getOutOfStock({
              deployment_id: parsedLicenceDetails.deployment_id,
              tab_id: tab_id,
            }).unwrap(),
            getServerTimeApi({}).unwrap(),
            getCxOffers(pipeline.tab_type).catch(() => null),
            isDynamicPricingEnabled
              ? fetchDpSessions().catch(() => [])
              : Promise.resolve([]),
          ]);
        dpItemsMap = await fetchDpItems(pipeline?._id, validDpSessions);

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
            try {
              await db.menus.put({
                tabId: tab_id,
                menuId: menu.MENU_ID,
                menu: menu,
              });
            } catch (error) {
              console.error("Error saving menu to DB", error);
            }
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

      if (
        menu.settings &&
        menu.settings.allow_multiple_punch &&
        menu.settings.allow_multiple_punch == true
      ) {
        dispatch(setAllowMultiplePunch(true));
      } else {
        dispatch(setAllowMultiplePunch(false));
      }

      const categoryMap = new Map<any, any>();

      if (menu?.settings?.send_categories === true) {
        dispatch(setEntpShowCategory({ entpShowCategory: true }));
        window.localStorage.setItem("entpShowCategory", "true");
      } else {
        dispatch(setEntpShowCategory({ entpShowCategory: false }));
        window.localStorage.setItem("entpShowCategory", "false");
      }
      if (serverTimeData && serverTimeData.serverTime) {
        const currentServerDate = new Date(serverTimeData.serverTime);
        currentServerDateWithTime = moment(currentServerDate);
      }

      const dpItemsMapToUse = dpItemsMap || dpItemsMapRdx;

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
      dispatch(setEntityMap({ entityMap: entityMapObject }));

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
      );

      const modifierMap = buildLegacyModifierMap(convertedData.modifiers);

      dispatch(
        setModifiersMap({
          modifiersMap: modifierMap,
        }),
      );

      if (oneCategoryAtATimeRdx) {
        computeLegacyOneCategoryPayloads(
          convertedData,
          showOnlySupCat,
          showEntpCategory,
        ).forEach((payload: any) => {
          dispatch(setMenuBasedOnCategory(payload));
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

        dispatch(
          setEntityModifierMap({
            entityAndModifierMap: entityWithModifiersMap,
          }),
        );

        dispatch(
          setCategoryMap({
            categoryMap: categoryMapData,
          }),
        );

        dispatch(
          setSubCategoryMap({
            subCategoryMap: subCategoryMap,
          }),
        );
        dispatch(
          setSubCategoryMapWhichContainsTopLevelCategoryIdAndName({
            subCategoryMapWhichContainsTopLevelCategoryIdAndName:
              subCategoryMapWhichContainsTopLevelCategoryIdAndName,
          }),
        );

        dispatch(
          setAllMenuWithoutChecks({
            inActiveEntities: inActiveEntityMap,
            inaActiveVariants: inActiveVariantMap,
          }),
        );
        //dispatching the variant
        dispatch(
          setEntityMenuObject({
            menuEntityObject: entityObject,
          }),
        );
        dispatch(
          setVariantObject({
            variantObject: variantAndBaseItemMapping,
          }),
        );
      } else {
        const { inActiveEntityMap, inActiveVariantMap } =
          collectLegacyInactiveMaps(menu, outOfStock);

        dispatch(
          setAllMenuWithoutChecks({
            inActiveEntities: inActiveEntityMap,
            inaActiveVariants: inActiveVariantMap,
          }),
        );
        //dispatching the variant
        dispatch(
          setEntityMenuObject({
            menuEntityObject: entityObject,
          }),
        );
        dispatch(
          setVariantObject({
            variantObject: variantAndBaseItemMapping,
          }),
        );
      }

      const deploymentCharges: any =
        window.localStorage.getItem("deploymentCharges") &&
        window.localStorage.getItem("deploymentCharges") !== "undefined"
          ? JSON.parse(window.localStorage.getItem("deploymentCharges") || "{}")
          : [];

      const menuCharges = convertMenuCharges(menu.charges, taxesMap, pipeline);
      const allCharges = [...deploymentCharges, ...menuCharges];

      dispatch(pushCharges(allCharges));
      dispatch(setMenuCharges({ menuCharges: menuCharges }));
      window.localStorage.setItem("menuCharges", JSON.stringify(menuCharges));
      window.localStorage.setItem("charges", JSON.stringify(allCharges));

      converOffersForGetItemByMenu(
        entityMapAfterConversion,
        categoryMap,
        variantEntityMap,
        fetchModifierProperties,
        offers,
      );

      setMenuLocal(convertedData);

      dispatch(setMenuData({ menu: convertedData }));
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

  //fetching the out of stock data
  const fetchOutOfStock = async (convertedMenu: any) => {
    try {
      const tabId = selectTabIdRdx;
      const licenceDetails = licenseDetails;
      const parsedLicenceDetails = JSON.parse(licenceDetails);
      const outOfStock = await getOutOfStock({
        deployment_id: parsedLicenceDetails.deployment_id,
        tab_id: tabId,
      }).unwrap();

      const updatedMenu = legacyAddOutOfStockField(
        convertedMenu,
        outOfStock,
        deepClone,
      );
      return updatedMenu;
    } catch (error) {
      console.error(error);
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
      dispatch(setBannerAvailableItems(availableItems));

      if (selectShowUpsellingItemAsSeperateItemRdx) {
        dispatch(setMappedUpsellIds({}));
      } else {
        dispatch(setMappedUpsellIds(mappedUpsellIds));
      }

      const deepCopyParsedMedia = mergeLegacyMediaItemMap(
        parsedMediaItems,
        language.type,
        mediaItemMapLocal,
      );

      //now setting this as final converted data

      if (tags?.size > 0) {
        dispatch(setTags({ tags: Array.from(tags) }));
      }

      dispatch(setMediaDataConverted(deepCopyParsedMedia));

      return newMenuItems;
    } catch (err) {
      // Returns undefined; fetchMenu's next read of the result then throws
      // into its catch (analytics + {} → the menu-error dialog).
      console.error("convertMenuData failed", err);
    }
  };

  function isCheckBoxRequiredFunction(min: any, max: any) {
    return legacyIsCheckBoxRequiredFunction(min, max);
  }

  //global function to fetch all the modifier groups and there items if it is not variant
  const fetchModifierProperties = (modifiersToBeSearched: Array<string>) => {
    return resolveLegacyModifierGroups(
      selectModifiersRdx,
      modifiersToBeSearched,
      deepClone,
    );
  };

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
    fetchOutOfStock,
    mapItemToCombos,
    isAllowMultiplePunch,
    filterByTags,
    fetchModifierPropertiesAll,
    isStepperRequired,
  };
}

export default useMenuConverters;
