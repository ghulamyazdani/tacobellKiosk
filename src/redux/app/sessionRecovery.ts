import { Cookies } from "react-cookie";
import { setLogOut } from "@cx-sdk/core/auth/authentication.slice";
import { resetDatabase } from "../../models/db";
import { clearTent } from "@cx-sdk/catalog/state/appSettings.slice";
import { emptyCart, removeCartOffer } from "@cx-sdk/ordering/state/cart.slice";
import { emptyOrder } from "@cx-sdk/ordering/state/order.slice";
import { emptyMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { clearFilters } from "@cx-sdk/catalog/state/filter.slice";
import { removeCustomerDetails } from "@cx-sdk/core/customer/customerInfo.slice";
import { closeBottomSheet } from "../features/menuSelections/menuSelections.slice";
import { emptySelectedLanguage } from "../features/multiLanguage/multiLanguage.slice";

/**
 * Session-recovery side effects extracted VERBATIM from apiSlice's
 * baseQueryWithReauth (P3d of the CX-SDK extraction).
 *
 * Why: the transport layer had browser teardown (window.location.replace,
 * localStorage.clear, cookie removal, Dexie reset) welded into it — the exact
 * coupling that keeps the transport out of @cx-sdk/core and off React Native.
 * The transport now signals through these two functions only; when the base
 * query moves into core they become the injected `onSessionInvalid` callback,
 * and eventually fold into the unified sdk.session.reset().
 *
 * Behavior is intentionally IDENTICAL to the previous inline blocks,
 * including the differences between the two paths (401 wipes storage +
 * IndexedDB; 504/505 dispatches the slice-by-slice empties instead).
 */

const cookies = new Cookies();

type Dispatch = (action: { type: string; payload?: unknown }) => unknown;

/** 401 (except checkMobileForQR): hard local logout + full storage teardown. */
export function recoverFromAuthFailure(dispatch: Dispatch): void {
  dispatch(setLogOut());
  if (cookies.get("token")) {
    cookies.remove("token", { path: "/" });
  }
  if (window.location.href !== window.location.origin + "/") {
    window.location.replace(window.location.origin + "/");
  }
  dispatch({ type: "RESET_STATE" });
  // eslint-disable-next-line no-restricted-globals -- this IS the designated storage-teardown adapter (401 path)
  localStorage.clear();
  resetDatabase();
  // eslint-disable-next-line no-restricted-globals -- see above
  sessionStorage.clear();
}

/** 504/505: slice-level session empty + reset, then return to the entry route. */
export function recoverFromServerError(dispatch: Dispatch): void {
  dispatch(setLogOut());
  dispatch(emptyOrder());
  dispatch(emptyMenuData());
  dispatch(emptyCart());
  dispatch(emptyCart());
  dispatch(clearFilters());
  dispatch(removeCartOffer());
  dispatch(removeCustomerDetails());
  dispatch(emptySelectedLanguage());
  dispatch(clearTent());
  dispatch(closeBottomSheet());
  dispatch({ type: "RESET_STATE" });

  if (cookies.get("token")) {
    cookies.remove("token", { path: "/" });
  }
  if (window.location.href !== window.location.origin + "/") {
    window.location.replace(window.location.origin + "/");
  }
}
