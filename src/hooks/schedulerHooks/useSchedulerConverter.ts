/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useSchedulerConverter wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
import moment from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import customParseFormat from "dayjs/plugin/customParseFormat";
// Kept for parity with the pre-extraction module: importing this hook used to
// register these dayjs plugins as a side effect, and other modules may rely on
// that. dayjs.extend is idempotent.
moment.extend(isBetween);
moment.extend(customParseFormat);

import {
  isValidAsPerSchedulers as isValidAsPerSchedulersEngine,
  applySchedulersToCartItems,
} from "@cx-sdk/catalog/scheduler/schedulerEngine";
import useCartIndexedDb from "../cartHooks/useCartIndexedDb";

function useSchedulerConverter() {
  const { updateCartItemsAvailability } = useCartIndexedDb();

  const isValidAsPerSchedulers = (schedulers: any, currentServerDate: any) =>
    isValidAsPerSchedulersEngine(schedulers, currentServerDate);

  const updateCartItemsByMenu = async (
    cartItems: any,
    _menu: any,
    entpShowCategory: any,
    currentServerDateWithTime: any,
  ) => {
    const { updatedCart, invalidSchedulerItemIds } = applySchedulersToCartItems(
      cartItems,
      entpShowCategory,
      currentServerDateWithTime,
      // The engine compiles without host globals; hand it the platform clone.
      (value) => structuredClone(value),
    );

    await updateCartItemsAvailability(updatedCart);

    return { updatedCart, invalidSchedulerItemIds };
  };

  return {
    isValidAsPerSchedulers,
    // checkCartItemsAsPerSchedulers,
    updateCartItemsByMenu,
  };
}

export default useSchedulerConverter;
