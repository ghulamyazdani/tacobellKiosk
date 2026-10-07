import { useEffect, useRef, useState } from "react";
import { useDispatch, useStore } from "react-redux";
import type { UnknownAction } from "@reduxjs/toolkit";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setTent } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  selectCurrentSession,
  setCurrentSession,
} from "@cx-sdk/catalog/state/dynamicPricing.slice";
import {
  pushCharges,
  setCartItems,
  setMenuCharges,
} from "@cx-sdk/ordering/state/cart.slice";
import {
  setFilteredOffers,
  setOffersFetchFailed,
} from "@cx-sdk/ordering/state/offer.slice";
import { planOrderTypeSwitchCommit } from "@cx-sdk/ordering/cart/orderTypeSwitch";
import type { SwitchablePipeline } from "@cx-sdk/ordering/cart/orderTypeTarget";
import useAppSettings from "../utils/useAppSettings";
import { useIdleHold } from "../utils/useIdleTimeout";
import useMenuConverters from "../menuHooks/useMenuConverters";
import useOfferApply from "../offerHooks/useOfferApply";
import useCartIndexedDb from "./useCartIndexedDb";
import {
  selectSecondaryLanguage,
  selectSelectedLanguage,
} from "../../redux/features/multiLanguage/multiLanguage.slice";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/*
 * In-bag EAT IN / TAKE OUT switch — the EXECUTOR (lane bag-pdp, item 19, D1).
 * Stage then commit, like the boot (P9e): the target's charges and menu
 * (offers, dynamic pricing, out-of-stock inside) are fetched with every
 * write STAGED; only when all of it succeeded does ONE synchronous burst
 * commit the /second selection + the staged writes + the re-priced bag. A
 * failure, timeout or unmount writes nothing. The SDK decides
 * (planOrderTypeSwitchCommit); this hook only fetches and applies.
 * Never navigates (H1) and never shows the notice — the lazy flow does.
 * Imported only by components/cart/OrderTypeSwitchFlow (bag lazy chunk).
 */

export type OrderTypeSwitchStatus = "idle" | "switching" | "failed";

export interface OrderTypeSwitchOutcome {
  ok: boolean;
  /** Nothing was written: unmounted mid-flight, or a duplicate call while one runs. */
  aborted?: boolean;
  /** Removed paid rows + removed loyalty rows (for the notice). */
  removedRows: readonly unknown[];
  offerDropped: boolean;
}

/** The cart fields the plan reads at commit time (house pattern, useOfferApply). */
interface SwitchRootState {
  cart?: { cartItems?: unknown[]; cartOffer?: unknown };
}

type FailedStage =
  | "target"
  | "charges"
  | "offers"
  | "menu"
  | "dpMax"
  | "commit"
  | "exception";

const NOTHING: OrderTypeSwitchOutcome = { ok: false, removedRows: [], offerDropped: false };

/** One field of a staged action's payload (the slices type their payloads loosely). */
const stagedField = (
  actions: readonly UnknownAction[],
  match: (action: unknown) => boolean,
  field: string,
): unknown => (actions.find(match)?.payload as Record<string, unknown> | undefined)?.[field];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export default function useOrderTypeSwitch(opts: {
  onRemoveLoyaltyRow: (row: unknown) => void;
}): {
  status: OrderTypeSwitchStatus;
  switchTo: (pipeline: SwitchablePipeline) => Promise<OrderTypeSwitchOutcome>;
} {
  const dispatch = useDispatch();
  const store = useStore();
  const { getChargesCountryDataApi } = useAppSettings();
  const { fetchMenu } = useMenuConverters();
  const { handleCartDrivenRemoval } = useOfferApply();
  const { replaceIndexedDbCart } = useCartIndexedDb();
  const [status, setStatus] = useState<OrderTypeSwitchStatus>("idle");
  const inFlight = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => void (mountedRef.current = false);
  }, []);
  // Every request is transport-bounded: charges 10 s ‖ menu 30 s + DP items
  // 10 s (OOS / server time 10 s, offers 3 × 8 s run beside the menu) — about
  // 50 s worst case, under the 120 s hold cap.
  useIdleHold(status === "switching");

  const fail = (stage: FailedStage): OrderTypeSwitchOutcome => {
    if (mountedRef.current) setStatus("failed");
    captureKioskEvent(KioskEventName.ErrorOccurred, {
      error_source: "order_type_switch",
      stage,
    });
    return NOTHING;
  };

  /** A step after the commit: the switch already happened, so it must not fail it. */
  const settle = (step: () => void) => {
    try {
      step();
    } catch {
      // Best effort — redux holds the committed state.
    }
  };

  const switchTo = async (pipeline: SwitchablePipeline): Promise<OrderTypeSwitchOutcome> => {
    // Latch: a duplicate call is ignored (the running switch decides the outcome).
    if (inFlight.current) return { ...NOTHING, aborted: true };
    inFlight.current = true;
    setStatus("switching");
    let stage: FailedStage = "exception";
    try {
      const tab = pipeline?.tab_id;
      if (!tab) return fail("target");
      const stagedCharges: UnknownAction[] = [];
      const stagedMenu: UnknownAction[] = [];
      const mirrors: [string, string][] = [];
      const mirror = (key: string, value: string) => {
        mirrors.push([key, value]);
      };
      const [charges, menu] = await Promise.all([
        getChargesCountryDataApi(tab, {
          apply: (action) => stagedCharges.push(action),
          mirror,
        }),
        // Parallel fetches: the final pushCharges below composes the charges,
        // so the menu leg needs none (and never reads localStorage for them).
        fetchMenu(tab, false, false, pipeline, {
          apply: (action) => stagedMenu.push(action),
          mirror,
          requireOffers: true,
          deploymentCharges: [],
        }),
      ]);
      // Rule 3: the session can end under the await — a late answer must
      // not write into the next customer's.
      if (!mountedRef.current) return { ...NOTHING, aborted: true };
      if (!charges.ok) return fail("charges");
      if (stagedMenu.some(setOffersFetchFailed.match)) return fail("offers");
      const entityMap = stagedField(stagedMenu, setEntityMap.match, "entityMap");
      const modifiersMap = stagedField(stagedMenu, setModifiersMap.match, "modifiersMap");
      if (!menu?.categories?.length || !isRecord(entityMap) || !isRecord(modifiersMap)) {
        return fail("menu");
      }

      const state = store.getState() as SwitchRootState;
      const offers: unknown = stagedMenu.find(setFilteredOffers.match)?.payload;
      // The DP session the commit leaves in force: the staged one
      // (fetchDpItems stages it), else the current one stays.
      const session = stagedMenu.find(setCurrentSession.match);
      const plan = planOrderTypeSwitchCommit({
        pipeline,
        // Exactly as SecondLayout reads them.
        languages: {
          primaryCode: selectSelectedLanguage(state)?.code ?? "",
          secondaryCode: selectSecondaryLanguage(state)?.code ?? "",
        },
        cartItems: state.cart?.cartItems,
        cartOffer: state.cart?.cartOffer,
        menu: { entityMap, modifiersMap },
        offeredOfferIds: Array.isArray(offers)
          ? offers.map((offer: { _id?: unknown } | null) => offer?._id)
          : [],
        currentSession: session ? session.payload : selectCurrentSession(state),
      });
      // D6: never commit a bag over the new session's DP cap — the add,
      // "+" and edit paths all refuse one. Nothing is written.
      if (plan.dpMaxExceeded) return fail("dpMax");
      const menuCharges = stagedField(stagedMenu, setMenuCharges.match, "menuCharges");
      const allCharges: unknown[] = [
        ...charges.deploymentCharges,
        ...(Array.isArray(menuCharges) ? menuCharges : []),
      ];

      // COMMIT — one synchronous burst, nothing awaited from here on.
      stage = "commit";
      [...plan.selectionActions, ...stagedCharges, ...stagedMenu].forEach((action) =>
        dispatch(action),
      );
      dispatch(pushCharges(allCharges));
      if (plan.reprice.changed) dispatch(setCartItems(plan.reprice.rows));
      // A tent number typed on the old tab (/tent BACK keeps it) belongs to
      // that tab's table; the order builder sends it whatever the tab type.
      dispatch(setTent(""));

      if (plan.reprice.changed) {
        settle(() => {
          replaceIndexedDbCart(plan.reprice.rows).catch(() => {});
        });
      }
      // Fork-parity mirrors, replayed only for a committed switch; the final
      // composition wins over the two legs' own "charges" writes.
      [...mirrors, ["charges", JSON.stringify(allCharges)] as [string, string]].forEach(
        ([key, value]) => settle(() => window.localStorage.setItem(key, value)),
      );
      plan.reprice.removedLoyalty.forEach((row) => settle(() => opts.onRemoveLoyaltyRow(row)));
      if (plan.dropOffer) settle(() => handleCartDrivenRemoval(false));

      const removedRows = [
        ...plan.reprice.removed.map(({ row }) => row),
        ...plan.reprice.removedLoyalty,
      ];
      const props = {
        source: "bag",
        tab_type: pipeline.tab_type,
        pipeline_id: pipeline._id,
        repriced: plan.reprice.repriced,
        removed: removedRows.length,
      };
      captureKioskEvent(KioskEventName.PipelineSelected, props);
      captureKioskEvent(KioskEventName.OrderTypeSelected, props);
      setStatus("idle");
      return { ok: true, removedRows, offerDropped: plan.dropOffer };
    } catch {
      return fail(stage);
    } finally {
      inFlight.current = false;
    }
  };

  return { status, switchTo };
}
