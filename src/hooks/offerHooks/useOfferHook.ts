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
 * The exported API is unchanged; tests that mock this hook wholesale keep
 * working. Engine calls are wrapped in per-render arrows so function identity
 * behaves exactly as before (a fresh reference every render).
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
import {
  isLeastValueItemOffer,
  isLeastValueItemOfferApplicable,
  getCheapestMatchingCartItem,
  computeLeastValueDiscount,
  getLeastValueFreebieDistribution,
} from "@cx-sdk/ordering/offer/leastValueOfferUtils";
import * as offerEngine from "@cx-sdk/ordering/offer/offerEngine";

function useOfferHook() {
  const dispatch = useDispatch();
  useSelector(selectDeploymentDetails);
  const selectCartOfferRdx = useSelector(selectCartOffer);
  const { getTabType, getCurrency, moduloCalcaledValue } = useAppSettings();
  useSelector(selectLicenseDetails);
  const { redeemGetItem, addGetItemToCart } = useCartHook();
  const discountOnAddonsRdx = useSelector(selectDiscountOnAddon);
  useGetCxOffersMutation();
  const [getCxValidOffersMutationApi, { isLoading: getCxValidOffersLoading }] =
    useGetCxValidOffersMutation();

  // The persisted cart offer used to be read from the closure inside the
  // engine's loop; it is now passed explicitly.
  const getDefaultOffer = (offers: any, cartValue: number, cartItems?: any) =>
    offerEngine.getDefaultOffer(
      offers,
      cartValue,
      cartItems,
      selectCartOfferRdx,
    );

  const isOfferValidToShow = (offer: any) =>
    offerEngine.isOfferValidToShow(offer);

  const isItemWiseOfferApplicable = (
    applicable: any,
    cartItems: any,
    minBillAmount: any,
  ) =>
    offerEngine.isItemWiseOfferApplicable(applicable, cartItems, minBillAmount);

  const isBOGOOfferApplicable = (offer: any, applicable: any, cartItems: any) =>
    offerEngine.isBOGOOfferApplicable(offer, applicable, cartItems);

  const isItemBasedGetOnlyOfferDirectlyApplicable = (offer: any) =>
    offerEngine.isItemBasedGetOnlyOfferDirectlyApplicable(offer);

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

  const getHighestAmountItemValueFromCartThatMatchesWithOfferBuyItems = (
    offer: any,
    cartItems: any,
  ) =>
    offerEngine.getHighestAmountItemValueFromCartThatMatchesWithOfferBuyItems(
      offer,
      cartItems,
    );

  const getHighestAmountGetItemValueFromCart = (cartItems: any) =>
    offerEngine.getHighestAmountGetItemValueFromCart(cartItems);

  //will be giving the cartItems adn return prices array
  function getCartPrices(cartItems: any) {
    return offerEngine.getCartPrices(cartItems);
  }

  //getting the best offer — the engine decides WHICH offer and WHICH message
  //applies; the English copy stays here (OfferDescription AST is a later phase)
  function findBestOfferForCart(cartPrices: any, offers: any) {
    const selection = offerEngine.findBestOfferSelection(cartPrices, offers);
    if (!selection) {
      return null;
    }
    const generatedString =
      selection.messageKind === "addMoreToUnlock"
        ? `Add ${selection.amountNeeded} more to unlock offer "${selection.bestOffer.name}".`
        : "No additional items needed to unlock this offer.";
    return {
      bestOffer: selection.bestOffer,
      generatedString,
    };
  }

  const getOfferValue = (offer: any, cartValue: number) =>
    offerEngine.getOfferValue(offer, cartValue);

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

  const isBuyDescriptionNeeded = (offer: any) =>
    offerEngine.isBuyDescriptionNeeded(offer);

  const getBuyItemsDescription = (offer: any) => {
    const getItemsDescription = offer?.applicable?.rawItems
      ?.map((entity: any, index: any) => {
        if (entity?.isRawItemAvailable && entity?.item?.name) {
          return ` ${
            entity?.quantity && entity?.quantity > 0
              ? ` ${entity?.quantity} `
              : ""
          } ${entity?.item?.name}  ${index + 1 < offer?.applicable?.rawItems?.length ? (offer?.applicable?.rawItems[index + 1]?.isRawItemAvailable ? (entity?.relation === "or" ? "or" : ",") : "") : ""}`;
        } else if (
          entity?.isRawItemAvailable &&
          entity?.category?.categoryName
        ) {
          return ` ${
            entity?.quantity && entity?.quantity > 0
              ? ` ${entity?.quantity} `
              : ""
          } ${entity?.quantity > 1 ? "items" : "item"} from ${entity?.category?.categoryName} category ${index + 1 < offer?.applicable?.rawItems?.length ? (offer?.applicable?.rawItems[index + 1]?.isRawItemAvailable ? (entity?.relation === "or" ? "or" : ",") : "") : ""}`;
        }
      })
      ?.join("");

    return getItemsDescription;
  };

  const isGetDescriptionNeeded = (offer: any) =>
    offerEngine.isGetDescriptionNeeded(offer);

  const getGetItemsDescription = (offer: any) => {
    let isAnyItemExist = false;
    let relation = "";
    let getItemsDescription = offer?.getItems?.items
      ?.map((item: any, index: any) => {
        if (item?.entities && Object.keys(item?.entities).length > 0) {
          if (index === offer?.getItems?.items?.length - 1) {
            isAnyItemExist = true;
            relation = item?.relation;
          }
          // if (Array.isArray(item?.entities)) {
          //   return `  ${item?.quantity ? item?.quantity : ""}  ${item?.entities?.map((entity: any, index: any) => `${entity?.name} ${entity?.selectedVariant ? "(" + entity?.selectedVariant?.name + ")" : ""} ${index === item?.entities?.length - 1 ? "" : "or"} `)}`;
          // } else {
          return ` ${item?.quantity ? item?.quantity : ""} ${item?.entities?.name} ${item?.discountType === "percent" ? (item?.value === 100 ? "for free" : "at " + item?.value + "% off") : "with " + getCurrency() + item?.value + " off"} ${item?.quantity > 1 ? "each" : ""} ${index + 1 < offer?.getItems?.items?.length ? (offer?.getItems?.items[index + 1]?.entities && Object.keys(offer?.getItems?.items[index + 1]?.entities).length > 0 ? (item?.relation === "or" ? "or" : ",") : "") : ""}`;
          // }
        }
      })
      ?.join("");

    const getCategoryText = offer?.getItems?.categories
      ?.map((category: any, index: any) => {
        if (category?.entities && category?.entities?.length > 0) {
          return ` ${category?.quantity ? category?.quantity : ""} ${category?.quantity > 1 ? "items" : "item"} from ${category?.name} category ${category?.discountType === "percent" ? (category?.value === 100 ? "for free" : "at " + category?.value + "% off") : "with " + getCurrency() + category?.value + " off"} ${category?.quantity > 1 ? "each" : ""} ${index + 1 < offer?.getItems?.categories?.length ? (offer?.getItems?.categories[index + 1]?.entities && offer?.getItems?.categories[index + 1]?.entities?.length > 0 ? (category?.relation === "or" ? "or" : ",") : "") : ""}`;
        }
      })
      ?.join("");

    if (getItemsDescription && getCategoryText) {
      if (isAnyItemExist && relation) {
        getItemsDescription =
          getItemsDescription + (relation === "or" ? "or" : ",");
      }
      getItemsDescription = getItemsDescription + getCategoryText;
    } else if (getCategoryText) {
      getItemsDescription = getCategoryText;
    }

    return getItemsDescription;
  };

  const isItemCriteriaDescriptionNeeded = (offer: any) =>
    offerEngine.isItemCriteriaDescriptionNeeded(offer);

  const getItemCriteriaOfferDescription = (offer: any) => {
    return `Offer ${offer?.applicable?.isExclude ? "will not be" : "is"} applicable on
    ${offer?.applicable?.rawItems
      ?.map((entity: any) => {
        if (entity?.item?.name) {
          return (
            entity?.item?.name +
            (entity?.quantity && entity?.quantity > 0
              ? ` (${entity?.quantity})`
              : "")
          );
        } else if (entity?.category?.categoryName) {
          return entity?.category?.categoryName + " category";
        }
      })
      .join(", ")}`;
  };

  const getMinBillAmountDescription = (offer: any) => {
    return offer?.applicable?.on === "complete"
      ? `Minimum cart value should be
          ${getCurrency() + moduloCalcaledValue(offer?.minBillAmount)}`
      : offer?.applicable?.on === "itemCriteria"
        ? `Minimum cart value should be
          ${getCurrency() + moduloCalcaledValue(offer?.minBillAmount)}
          ${offer?.applicable?.isInclude ? "excluding addons price and will be applicable only on below items/categories" : ""}`
        : "";
  };

  const getLeastValueItemBuyNames = (offer: any) => {
    const rawItems = offer?.applicable?.rawItems;
    if (!Array.isArray(rawItems) || rawItems.length === 0) return "";
    const names: string[] = [];
    let categoryOnly = false;
    rawItems.forEach((entity: any) => {
      const itemName = entity?.item?.name;
      const categoryName = entity?.category?.categoryName;
      if (itemName) {
        names.push(itemName);
      } else if (categoryName) {
        names.push(`${categoryName} category`);
        categoryOnly = true;
      }
    });
    if (names.length === 0) return "";
    const MAX = 3;
    let listed: string;
    if (names.length <= MAX) {
      if (names.length === 1) listed = names[0];
      else if (names.length === 2) listed = `${names[0]} or ${names[1]}`;
      else
        listed = `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
    } else {
      const extras = names.length - MAX;
      listed = `${names.slice(0, MAX).join(", ")} +${extras} more`;
    }
    return categoryOnly && names.length === 1 ? `from ${listed}` : `from ${listed}`;
  };

  const getLeastValueItemDescription = (offer: any) => {
    if (!isLeastValueItemOffer(offer)) return "";
    const buyQty = offer?.leastItemValueCount?.buyQuantity;
    const getQty = offer?.leastItemValueCount?.getQuantity;
    const getDiscount = offer?.leastItemValueCount?.getDiscount;
    if (!buyQty || !getQty) return "";
    const discountText =
      getDiscount === null || getDiscount === undefined
        ? "free"
        : `${getDiscount}% off`;
    const buyNames = getLeastValueItemBuyNames(offer);
    const cheapestSuffix =
      getQty === 1 ? "the cheapest" : `${getQty} cheapest`;
    let text = `Buy ${buyQty}${buyNames ? ` ${buyNames}` : ""}, get ${cheapestSuffix} ${discountText}`;
    const extras: string[] = [];
    if (offer?.minBillAmount) {
      extras.push(`Min bill ${getCurrency()}${offer.minBillAmount}`);
    }
    if (offer?.minItemCount) {
      extras.push(
        `Min ${offer.minItemCount} ${offer.minItemCount === 1 ? "item" : "items"}`,
      );
    }
    if (extras.length > 0) text += ` • ${extras.join(" • ")}`;
    return text;
  };

  const isDiscountOnAddonOffDescriptionNedded = (offer: any) =>
    offerEngine.isDiscountOnAddonOffDescriptionNedded(
      offer,
      discountOnAddonsRdx,
    );

  return {
    getDefaultOffer,
    getOfferValue,
    findBestOfferForCart,
    getCartPrices,
    isItemWiseOfferApplicable,
    getCxOffers,
    getCxOffersLoading: getCxValidOffersLoading,
    applyOfferByItem,
    applyDirectlyApplicableGetItemsOffer,
    isBOGOOfferApplicable,
    getHighestAmountItemValueFromCartThatMatchesWithOfferBuyItems,
    getHighestAmountGetItemValueFromCart,
    isOfferValidToShow,
    isItemBasedGetOnlyOfferDirectlyApplicable,
    isGetDescriptionNeeded,
    getGetItemsDescription,
    isBuyDescriptionNeeded,
    getBuyItemsDescription,
    isItemCriteriaDescriptionNeeded,
    getItemCriteriaOfferDescription,
    getMinBillAmountDescription,
    isDiscountOnAddonOffDescriptionNedded,
    isLeastValueItemOffer,
    isLeastValueItemOfferApplicable,
    getCheapestMatchingCartItem,
    computeLeastValueDiscount,
    getLeastValueFreebieDistribution,
    getLeastValueItemDescription,
  };
}
export default useOfferHook;
