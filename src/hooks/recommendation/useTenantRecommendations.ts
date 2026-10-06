import { useCallback } from "react";
import { createSelector } from "@reduxjs/toolkit";
import { useDispatch, useSelector, useStore } from "react-redux";
import { isTimeoutError, withTimeoutRetry } from "@cx-sdk/core";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { setReccomendationCategoryMap } from "@cx-sdk/catalog/state/recommendation.slice";
import { selectEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { selectFilters } from "@cx-sdk/catalog/state/filter.slice";
import type {
  EntityMap,
  OutOfStockMap,
} from "@cx-sdk/catalog/recommendation/recommendationUtils";
import {
  collectTenantRecommendations,
  toTenantRecommendationMap,
  type TenantRecommendationMap,
} from "@cx-sdk/catalog/recommendation/tenantRecommendations";
import { selectOutOfStockItems } from "../../redux/features/menuSelections/menuSelections.slice";
import { db } from "../../models/db";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/*
  Tenant (S3) cart recommendations — the app half of posistKiosk's
  useRecommendationHook (post-P9 29a/29b). The ranking lives in the SDK
  (catalog/recommendation/tenantRecommendations); this file owns the URL, the
  fetch, the Dexie copy and the bag-rail selector.

  The map is device data, never session state: it lives in redux memory
  (state.recommendation, NOT persisted — the store's single persist:root
  would re-serialise ~350 KB on every cart tap) and in Dexie
  (`recommendations`, key "latest"), which resetDatabase clears at
  registration, logout and the 401 recovery.
*/

/** Dexie row key — the fork's RECOMMENDATION_CACHE_KEY. */
const CACHE_KEY = "latest";

/**
 * The tenant's public recommendations JSON (D6). Read BY NAME so Vite inlines
 * only this key; empty means the feature is off. TB rule 6: the URL is set
 * per deployment in .env.*, never committed.
 *
 * DEV-only e2e seam (precedent: `__TB_FCM_ENV__` in useFcmRegistration): a
 * spec sets `window.__TB_RECS_URL__` with addInitScript, because Playwright
 * reuses an already-running `yarn dev` and would ignore webServer.env.
 * `import.meta.env.DEV` is false in builds, so the seam is dead code there.
 */
export function tenantRecommendationsUrl(): string {
  const injected: unknown = import.meta.env.DEV
    ? (window as unknown as { __TB_RECS_URL__?: unknown }).__TB_RECS_URL__
    : undefined;
  const value: unknown =
    injected ?? import.meta.env.VITE_TENANT_RECOMMENDATIONS_URL;
  return typeof value === "string" ? value.trim() : "";
}

const reportFailure = (
  source: "recommendations_fetch" | "recommendations_cache",
  error: unknown,
) => {
  const e = error as { status?: unknown; name?: unknown } | null | undefined;
  captureKioskEvent(KioskEventName.ErrorOccurred, {
    error_source: source,
    error_status: String(e?.status ?? e?.name ?? "unknown"),
    timed_out: isTimeoutError(error),
  });
};

/** Only the slices this file reads (useCartUpsell's narrow-state pattern, no any). */
interface TenantRecsRootState {
  recommendation?: { recommendCategoryMap?: TenantRecommendationMap };
  cart?: { cartItems?: { id?: string }[] };
  menu?: { entityMap?: EntityMap };
  menuSelections?: { outOfStockItems?: OutOfStockMap };
  filter?: { filters?: string[] };
  appSettings?: {
    kiosk_settings?: {
      enable_cart_upsell_screen?: boolean;
      enable_combo_upsell?: boolean;
    };
  };
}

const selectTenantMap = (state: TenantRecsRootState) =>
  state.recommendation?.recommendCategoryMap;

const isEmptyMap = (map: TenantRecommendationMap | null | undefined) =>
  !map || Object.keys(map).length === 0;

/**
 * refresh(): the boot's post-commit background fetch (29b). loadCached(): the
 * Dexie copy at app mount, because a relaunch never boots (P9e). Both are
 * stable and NEVER reject.
 *
 * No mounted-ref guard, by design: the map is device-scoped data — no
 * navigation follows, and nothing written here is session state — so a late
 * answer after the caller unmounted is still the right write.
 */
export default function useTenantRecommendations(): {
  refresh: () => Promise<void>;
  loadCached: () => Promise<void>;
} {
  const dispatch = useDispatch();
  // Read at CALL time (useAutoUpdate precedent): loadCached must see a map a
  // boot dispatched while the Dexie read was in flight.
  const store = useStore();

  const refresh = useCallback(async (): Promise<void> => {
    const url = tenantRecommendationsUrl();
    if (!url) return;

    let map: TenantRecommendationMap;
    try {
      // A raw fetch, NEVER the RTK transport: that would send the kiosk's
      // authorization / x-access-token / login_code to S3. No custom headers
      // and no credentials keep it a simple CORS GET (no preflight).
      const result = await withTimeoutRetry(
        (signal): Promise<unknown> =>
          fetch(url, { signal, credentials: "omit", cache: "no-cache" }).then(
            (response) =>
              response.ok
                ? response.json()
                : Promise.reject({ status: response.status }),
          ),
        { timeoutMs: 10_000, retries: 1 },
      );
      if (!result.ok) {
        reportFailure("recommendations_fetch", result.error);
        return;
      }
      map = toTenantRecommendationMap(result.data);
    } catch (error) {
      reportFailure("recommendations_fetch", error); // never thrown; Rule 2
      return;
    }

    // An empty or junk body keeps the last good map (memory and Dexie), but is
    // reported: a reshaped or emptied feed must not freeze the rail unseen.
    if (isEmptyMap(map)) {
      reportFailure("recommendations_fetch", { status: "empty_body" });
      return;
    }
    dispatch(setReccomendationCategoryMap(map));
    try {
      await db.recommendations.put({ key: CACHE_KEY, map, url, fetchedAt: Date.now() });
    } catch (error) {
      reportFailure("recommendations_cache", error);
    }
  }, [dispatch]);

  const loadCached = useCallback(async (): Promise<void> => {
    // Empty URL = off (D6): a copy left by an earlier build must not show.
    const url = tenantRecommendationsUrl();
    if (!url) return;
    try {
      const cached = await db.recommendations.get(CACHE_KEY);
      // D6: the env URL decides the source — a copy fetched from another URL
      // never shows, even while the current URL keeps failing.
      if (cached?.url !== url) return;
      // Re-validated, never trusted: the row may predate this code.
      const map = toTenantRecommendationMap(cached?.map);
      if (isEmptyMap(map)) return;
      // A boot's fresh map may have landed during the await — keep it.
      if (!isEmptyMap(selectTenantMap(store.getState() as TenantRecsRootState))) {
        return;
      }
      dispatch(setReccomendationCategoryMap(map));
    } catch (error) {
      reportFailure("recommendations_cache", error);
    }
  }, [dispatch, store]);

  return { refresh, loadCached };
}

/** Shared, so the D7-off rail and a no-match cart never mint a new array. */
const EMPTY: RecommendedEntity[] = [];

/**
 * The bag rail's tenant list, memoised over its inputs. D7 (TB semantics,
 * a divergence from the fork, which ignores the flag here):
 * `enable_cart_upsell_screen: false` hides the tenant list too, so the flag
 * keeps meaning "no in-bag rail".
 */
const selectTenantRailItems = createSelector(
  [
    selectTenantMap,
    (state: TenantRecsRootState) => state.cart?.cartItems,
    selectEntityMap,
    selectOutOfStockItems,
    selectFilters,
    (state: TenantRecsRootState) =>
      state.appSettings?.kiosk_settings?.enable_combo_upsell,
    (state: TenantRecsRootState) =>
      state.appSettings?.kiosk_settings?.enable_cart_upsell_screen === false,
  ],
  (map, cartItems, entityMap, outOfStock, filters, comboUpsell, railOff) =>
    railOff
      ? EMPTY
      : collectTenantRecommendations(
          map,
          cartItems,
          entityMap,
          outOfStock,
          filters,
          comboUpsell,
        ),
);

/** Tenant recommendations for the current cart; [] when none apply. */
export function useTenantRailItems(): RecommendedEntity[] {
  return useSelector(selectTenantRailItems);
}
