/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useOfferHook wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
/**
 * Thin wrapper over the pure offer engine — the eligibility predicates,
 * default-offer selection, valuation math, and cart matchers moved verbatim to
 * @cx-sdk/ordering/offer/offerEngine (P6). This hook keeps only what cannot
 * live in the SDK: state gathering (useSelector), the withTimeoutRetry-wrapped
 * offers fetch (dispatch + analytics), the get-item apply loops that mutate
 * the cart through useCartHook, and every English description string (the
 * OfferDescription AST is a later phase — copy stays app-side).
 *
 * Tests that mock this hook wholesale keep working. Engine calls are wrapped
 * in per-render arrows so function identity behaves exactly as before (a
 * fresh reference every render).
 *
 * Boot-path trim (bag-pdp residual R1, applied by lane addon-customize under
 * the CI budget ladder): the 22 members no caller read — the default-offer /
 * best-offer / valuation wrappers and every English description builder —
 * are gone; the store subscriptions they read are kept as bare calls, so the
 * host still re-renders exactly as before. The engine keeps them all
 * (@cx-sdk/ordering/offer/offerEngine, leastValueOfferUtils).
 */
import { useDispatch } from "react-redux";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  useGetCxOffersMutation,
  useGetCxValidOffersMutation,
} from "@cx-sdk/ordering/services/kioskOfferApi";
import { selectLicenseDetails } from "@cx-sdk/core/auth/authentication.slice";
import { useSelector } from "react-redux";
import { selectCartOffer } from "@cx-sdk/ordering/state/cart.slice";
import useAppSettings from "../utils/useAppSettings";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
import useCartHook from "../menuHooks/useCartHook";
import {
  setOffers,
  setOffersFetchLoading,
  setOffersFetchFailed,
} from "@cx-sdk/ordering/state/offer.slice";
import { withTimeoutRetry } from "@cx-sdk/core";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import { selectDiscountOnAddon } from "@cx-sdk/catalog/state/appSettings.slice";
import { isLeastValueItemOffer } from "@cx-sdk/ordering/offer/leastValueOfferUtils";
import * as offerEngine from "@cx-sdk/ordering/offer/offerEngine";

function useOfferHook() {
  const dispatch = useDispatch();
  useSelector(selectDeploymentDetails);
  useSelector(selectCartOffer);
  const { getTabType } = useAppSettings();
  useSelector(selectLicenseDetails);
  const { redeemGetItem, addGetItemToCart } = useCartHook();
  useSelector(selectDiscountOnAddon);
  useGetCxOffersMutation();
  const [getCxValidOffersMutationApi] = useGetCxValidOffersMutation();

  const isItemWiseOfferApplicable = (
    applicable: any,
    cartItems: any,
    minBillAmount: any,
  ) =>
    offerEngine.isItemWiseOfferApplicable(applicable, cartItems, minBillAmount);

  const isBOGOOfferApplicable = (offer: any, applicable: any, cartItems: any) =>
    offerEngine.isBOGOOfferApplicable(offer, applicable, cartItems);

  const applyDirectlyApplicableGetItemsOffer = async (offer: any) => {
    offer?.getItems?.items?.forEach((item: any) => {
      if (item?.entities && Object.keys(item?.entities).length > 0) {
        for (let i = 0; i < (item?.type === "ITEM" ? 1 : item?.quantity); i++) {
          const itemToAdd = redeemGetItem(
            item?.entities,
            item?.discountType,
            item?.quantity,
            item?.value,
            item?.type === "ITEM",
          );

          addGetItemToCart(
            itemToAdd,
            itemToAdd?.type ? itemToAdd?.type : "ITEM",
          );
        }
      }
    });
  };

  const applyOfferByItem = async (item: any) => {
    for (let i = 0; i < (item?.type === "ITEM" ? 1 : item?.quantity); i++) {
      const itemToAdd = await redeemGetItem(
        item?.entities,
        item?.discountType,
        item?.quantity,
        item?.value,
        item?.type === "ITEM",
      );
      addGetItemToCart(itemToAdd, itemToAdd?.type ? itemToAdd?.type : "ITEM");
    }
  };

  /**
   * Fetch the offer catalogue for this tab.
   *
   * Previously: no timeout, no retry, and a bare `console.error` that returned
   * undefined — which both call sites then swallowed again with
   * `.catch(() => null)`. A single blip meant the offer surface silently
   * vanished for the whole session, the customer paid full price, and nobody
   * learned it happened. Now it is bounded (8s × up to 3 attempts) and the
   * failure is recorded in state so the cart can say so and offer a retry.
   * (CLAUDE.md Rule 2 · docs/OFFERS_REDESIGN.md §5.1 P4)
   *
   * `apply` defaults to dispatch; the in-bag order-type switch passes its
   * stage so nothing lands before its one commit (fetchMenu opts).
   */
  const getCxOffers = async (
    tabType: any,
    apply: (action: UnknownAction) => unknown = dispatch,
  ) => {
    const offerTabType = tabType ? tabType : getTabType();
    apply(setOffersFetchLoading());

    const result = await withTimeoutRetry(
      async () => {
        const request = getCxValidOffersMutationApi({
          isDeploymentOffers: true,
          isBrandOffers: true,
          tab_type: offerTabType,
          app: "kiosk",
        });
        return await request.unwrap();
      },
      { timeoutMs: 8000, retries: 2 },
    );

    if (!result.ok) {
      apply(setOffersFetchFailed({ attempts: result.attempts }));
      captureKioskEvent(KioskEventName.OffersFetchFailed, {
        attempts: result.attempts,
        timed_out: result.timedOut,
      });
      // Deliberately returns undefined, as before, so existing callers keep
      // their current behaviour — but the failure is now visible in state.
      return undefined;
    }

    apply(setOffers(result.data));
    return result.data;
  };

  return {
    isItemWiseOfferApplicable,
    getCxOffers,
    applyOfferByItem,
    applyDirectlyApplicableGetItemsOffer,
    isBOGOOfferApplicable,
    isLeastValueItemOffer,
  };
}
export default useOfferHook;
