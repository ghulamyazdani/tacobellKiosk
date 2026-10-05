/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useOrderHook wrapper (customization vertical
 * port, transitive dep of useLoyalty). The anys are inherited; typed in later
 * domain passes. Do not add NEW anys.
 */
/**
 * THIN WRAPPER (P6) — the pure order-payload logic moved VERBATIM to
 * @cx-sdk/ordering/order/orderBuilder (convertCart, getCalculatedBill,
 * buildPushOrderPayload, payment-type predicates, hasSetting,
 * generateQROrderId). This hook now only gathers state (useSelector /
 * useAppSettings), reads import.meta.env, calls the engine, and performs the
 * side effects: RTK mutation fan-out, dispatches, IndexedDB, localStorage,
 * timers, navigation. The exported API is unchanged.
 */
import { useState } from "react";
import {
  selectDeploymentInfo,
  selectDiscountOnAddon,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { useSelector } from "react-redux";
import {
  usePlaceByBackendOrderingMutation,
  usePushOnlineOrderMutation,
} from "@cx-sdk/ordering/services/orderApi";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { selectTabId } from "@cx-sdk/core/auth/authentication.slice";
import { useGetOrderByIdForQRMutation } from "@cx-sdk/ordering/services/orderApi";
import { selectOrderId } from "@cx-sdk/ordering/state/order.slice";
import useOrderIndexDb from "../indexedDb/useOrderIndexDb";
import { pushOrderInOngoingOrders } from "@cx-sdk/ordering/state/order.slice";
import { useDispatch } from "react-redux";
import { getImageUrlFromAggregator } from "@cx-sdk/catalog/menu/menuUtils";
import { useGetOutOfStockMutation } from "@cx-sdk/catalog/services/outOfStockApi";
import { removeOrderFromOngoingOrders } from "@cx-sdk/ordering/state/order.slice";
import { selectLicenseDetails } from "@cx-sdk/core/auth/authentication.slice";

import {
  tentRdx,
  // selectDiscountOnAddon,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  selectGeideaPaymentDone,
  selectNeoLeapPaymentDone,
  selectKioskPaymentType,
  selectNetworkInternationalPaymentDone,
  selectSourceId,
  selectDojoPaymentDone,
  selectDojoSessionInfo,
} from "@cx-sdk/payments/state/payment.slice";
import { setShowErrorModal } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  removeClaimedCoupon,
  selectRedeemedLoyalty,
  selectIsReeloLoyalty,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { selectCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import {
  selectCustomerInfo,
  selectCustomerPhone,
} from "@cx-sdk/core/customer/customerInfo.slice";
import { appliedCharges } from "@cx-sdk/ordering/state/order.slice";

import { selectOngoingOrders } from "@cx-sdk/ordering/state/order.slice";
import useAppSettings from "../utils/useAppSettings";

import _ from "lodash";
import { stopTimer } from "@cx-sdk/core/session/timer.slice";
import { useNavigate } from "react-router-dom";
import {
  buildPushOrderPayload,
  convertCart as convertCartEngine,
  extractPaymentPayload,
  generateQROrderId,
  getCalculatedBill as getCalculatedBillEngine,
  hasSetting,
  type CartConversionContext,
} from "@cx-sdk/ordering/order/orderBuilder";

function useOrderHook() {
  const selectKioskPaymentTypeRdx = useSelector(selectKioskPaymentType);
  const deploymentInfoRdx = useSelector(selectDeploymentInfo);
  const {
    getTabType,
    getTabId,
    getIsLoyaltyOn,
    getSelectedPipeline,
    getAmountBasedItemValue,
    getPrinterName,
    getPrinterIp,
    getIsPrintOnPos,
  } = useAppSettings();
  // Verbatim parity: the original bound `orderStatusData` (read only by the
  // dead getOfferInTable). Bare call keeps the store subscription identical.
  useSelector(selectOngoingOrders);
  // Verbatim parity: the original bound `orderIdRdx` (unused). Bare call
  // keeps the store subscription identical.
  useSelector(selectOrderId);
  const selectLicenseDetailsRdx = useSelector(selectLicenseDetails);
  const cartRdx = useSelector(selectCart);
  const isLoyaltySettingOn = getIsLoyaltyOn();
  const redeemedLoyaltyRdx = useSelector(selectRedeemedLoyalty);
  const isReeloLoyaltyRdx = useSelector(selectIsReeloLoyalty);
  const selectedCountryCode = useSelector(selectCountryCode);
  const discountOnAddonRdx = useSelector(selectDiscountOnAddon);
  const navigate = useNavigate();
  const tabId = useSelector(selectTabId) || getTabId();
  const tentNumber = useSelector(tentRdx);
  const appliedChargesRdx = useSelector(appliedCharges);
  const selectCustomerInfoRdx = useSelector(selectCustomerInfo);
  const selectUserNumberRdx = useSelector(selectCustomerPhone);
  const [pushOnlineOrder] = usePushOnlineOrderMutation();
  const [placeByBackendOrdering] = usePlaceByBackendOrderingMutation();
  const dispatch = useDispatch();
  const [getOrderByIdApi, { isLoading: isGetOrderByIdApiLoading }] =
    useGetOrderByIdForQRMutation();

  const { addOrderToIndexedDb, deleteOrderIndexedDb } = useOrderIndexDb();
  const [getOutOfStockApi] = useGetOutOfStockMutation();

  const selectGediaPaymentDoneRdx = useSelector(selectGeideaPaymentDone);
  const selectNeoLeapPaymentDoneRdx = useSelector(selectNeoLeapPaymentDone);
  const selectDojoPaymentDoneRdx = useSelector(selectDojoPaymentDone);
  const selectDojoSessionInfoRdx = useSelector(selectDojoSessionInfo);
  const selectNetworkInternationalPaymentDoneRdx = useSelector(
    selectNetworkInternationalPaymentDone,
  );
  const selectSourceIdRdx = useSelector(selectSourceId);

  const tabType = getTabType();
  const [orderStatus, setOrderStatus] = useState<any>({});

  // The closure state the engine's cart→order conversion needs, gathered per
  // call so it always reflects the current render's redux values.
  const getConversionContext = (): CartConversionContext => ({
    tabId,
    deploymentInfo: deploymentInfoRdx,
    discountOnAddon: discountOnAddonRdx,
    cartRdx,
    getAmountBasedItemValue,
    getImageUrl: getImageUrlFromAggregator,
  });

  const convertCart = (cart: any) => {
    return convertCartEngine(cart, getConversionContext());
  };

  const getCalculatedBill = (cart: any) => {
    return getCalculatedBillEngine(cart, getConversionContext());
  };

  const pushOrder = async (
    orderId: any,
    useIncomingNetAmount: any,
    netAmount: any,
  ) => {
    const { toPush, pushOrderData } = await getPushOrderData(orderId);

    try {
      if (
        selectKioskPaymentTypeRdx === "Geidea" ||
        selectKioskPaymentTypeRdx == "NeoLeap" ||
        selectKioskPaymentTypeRdx === "Dojo"
      ) {
        await placeByBackendOrdering({
          ...extractPaymentPayload(toPush),
        }).unwrap();
      } else if (
        selectKioskPaymentTypeRdx === "NetworkInternational" ||
        selectKioskPaymentTypeRdx === "PaytmDynamicQr" ||
        selectKioskPaymentTypeRdx === "PaytmEdc"
      ) {
        // No API call: the backend has ALREADY placed the order (NI settlement
        // queue, or Paytm webhook/poll → saveOrder). Calling a place endpoint here
        // would double-place. We only run the local bookkeeping below
        // (addOrderInCurrentOrders + coupon cleanup) so /orderSuccess and the
        // printed ticket can render source/items from the cart.
      } else {
        await pushOnlineOrder({
          ...toPush,
        }).unwrap();
      }

      addOrderInCurrentOrders({
        cartInfo: cartRdx,
        netAmount: useIncomingNetAmount ? netAmount : cartRdx.netAmount,
        orderInfo: pushOrderData,
        offer: cartRdx?.cartOffer,
        orderId: orderId,
        orderStatus: "PENDING",
        isRejected: false,
        rejectionReason: "",
        orderTime: new Date().toISOString(),
      });
      dispatch(removeClaimedCoupon());
      // FORK PARITY: posistKiosk mirrors the claimed coupon into localStorage;
      // cleanup must hit the same key. Folds into the persistence manifest later.
      // eslint-disable-next-line no-restricted-globals -- fork-parity raw storage site
      localStorage.removeItem("claimedCoupon");
    } catch (err: any) {
      dispatch(
        setShowErrorModal({
          errorMessage: "Order not placed, please try again",
          showErrorModal: true,
        }),
      );
      throw Error(err, { cause: err });
    } finally {
      // dispatch(pushOrderInOngoingOrders(pushOrderData));
    }
  };

  const getPushOrderData = async (orderId: any) => {
    const url = import.meta.env.VITE_API_ENDPOINT;

    return buildPushOrderPayload({
      orderId,
      cartRdx,
      tabType,
      tabId,
      tentNumber,
      deploymentInfoRdx,
      discountOnAddonRdx,
      appliedChargesRdx,
      url,
      selectedCountryCode,
      selectedPipeline: getSelectedPipeline(),
      selectLicenseDetailsRdx,
      selectKioskPaymentTypeRdx,
      selectSourceIdRdx,
      selectCustomerInfoRdx,
      selectUserNumberRdx,
      selectGediaPaymentDoneRdx,
      selectNeoLeapPaymentDoneRdx,
      selectDojoPaymentDoneRdx,
      selectDojoSessionInfoRdx,
      selectNetworkInternationalPaymentDoneRdx,
      printerName: getPrinterName(),
      printerIp: getPrinterIp(),
      isPrintOnPos: getIsPrintOnPos(),
      isLoyaltySettingOn,
      isReeloLoyaltyRdx,
      redeemedLoyaltyRdx,
      getAmountBasedItemValue,
      getImageUrl: getImageUrlFromAggregator,
    });
  };

  const getOrderDetailsByOrderId = async (orderId: string) => {
    try {
      const response = await getOrderByIdApi({ order_id: orderId }).unwrap();
      setOrderStatus(response);
      return response;
    } catch (err: any) {
      return Error(err);
    }
  };

  // add current orders in ongoing orders
  const addOrderInCurrentOrders = (order: any) => {
    addOrderToIndexedDb(order);
    dispatch(pushOrderInOngoingOrders(order));
  };

  const removeOrderFromCurrentOrders = (orderId: any) => {
    dispatch(removeOrderFromOngoingOrders(orderId));
    deleteOrderIndexedDb(orderId);
  };

  const getOosItems = async (_cartItems: any) => {
    await getOutOfStockApi({}).unwrap();
  };

  const isInclusiveTaxOn = () => {
    const checkTaxIncl = hasSetting("inclusive_tax", deploymentInfoRdx);
    return checkTaxIncl;
  };

  const pushOrderAfterPayment = async (possBillNo: any) => {
    await pushOrder(possBillNo, false, 0);
    window.localStorage.removeItem("timeRemaining");
    dispatch(stopTimer(135));
    navigate("/orderSuccess");
  };

  return {
    convertCart,
    removeOrderFromCurrentOrders,
    getCalculatedBill,
    orderStatus,
    pushOrder,
    generateQROrderId,
    getOrderDetailsByOrderId,
    isGetOrderByIdApiLoading,
    getOosItems,
    isInclusiveTaxOn,
    getPushOrderData,
    pushOrderAfterPayment,
  };
}

export default useOrderHook;
