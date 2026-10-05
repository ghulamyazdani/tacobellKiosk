/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useLoyalty wrapper (customization vertical
 * port, transitive dep of useCustomization). The anys are inherited; typed in
 * later domain passes. Do not add NEW anys.
 */
// Thin wrapper over the pure loyalty engine (@cx-sdk/ordering/loyalty/loyaltyEngine).
// This hook keeps ONLY the impure edges: redux selectors/dispatches, the RTK
// Query executeLoyaltyEvent transport, uuid generation, console logging, the
// localStorage claimed-coupon cleanup, and the raw Xeno undoRewardRedemption
// fetch (KNOWN Rule-2 violation — kept verbatim on purpose). All payload
// building, coupon/menu matching, discount math and the payment-bypass
// predicate live in the engine.
import { useExecuteLoyaltyEventMutation } from "@cx-sdk/ordering/services/loyaltyApi";
import { selectLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { useSelector } from "react-redux";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
import { pushLoyaltyPointsAndCoupons } from "@cx-sdk/ordering/state/loyalty.slice";
import { useDispatch } from "react-redux";
import { selectMenu } from "@cx-sdk/catalog/state/Menu.slice";
import { pushLoyaltyItems } from "@cx-sdk/ordering/state/loyalty.slice";
import { parkRedeemedItem } from "@cx-sdk/ordering/state/loyalty.slice";
import { selectCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import { selectPhoneNumber } from "@cx-sdk/core/customer/customerInfo.slice";
import { selectTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { v4 as uuid } from "uuid";
import useOrderHook from "../menuHooks/useOrderHook";
import { setClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import { selectClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import { removeClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import {
  xenoExpectedSuccessResponse,
  buildLoyaltyEventPartners,
  buildLoyaltyPointsAndCouponsUpdate,
  buildCheckLoyaltyBalancePayload,
  buildValidateCouponPayload,
  buildAuthenticateRedemptionPayload,
  buildRedeemCouponPayload,
  buildInfoForClaim,
  buildClaimedCouponRecord,
  buildReeloPointsRedemptionPayload,
  getAllLoyaltyItemsFromMenu as getAllLoyaltyItemsFromMenuEngine,
  redeemItem as redeemItemEngine,
  vaildateLoyaltyIfRedeemedFromLoyalty as vaildateLoyaltyIfRedeemedFromLoyaltyEngine,
  shouldPlaceLoyaltyOrderDirectly as shouldPlaceLoyaltyOrderDirectlyEngine,
} from "@cx-sdk/ordering/loyalty/loyaltyEngine";

function useLoyalty() {
  const [executeLoyaltyEvent, { isLoading: isLoyaltyEventLoading, reset: resetLoyaltyEvent }] =
    useExecuteLoyaltyEventMutation();
  const countryCode = useSelector(selectCountryCode);
  const claimedCouponRdx = useSelector(selectClaimedCoupon);
  const phoneNumber = useSelector(selectPhoneNumber);
  const tabTypeRdx = useSelector(selectTabType);
  // Same guard as useAppSettings.getTabType — the slice can hold "undefined".
  const tabType =
    tabTypeRdx && tabTypeRdx !== "undefined" ? tabTypeRdx : "";
  const loyaltyPartnerRdx = useSelector(selectLoyaltyPartner);
  const dispatch = useDispatch();
  const menuData = useSelector(selectMenu);
  // Verbatim parity: the original destructured `getCalculatedBill` (unused).
  // The bare call keeps hook order and store subscriptions identical.
  useOrderHook();

  const selectDeploymentDetailsRdx = useSelector(selectDeploymentDetails);

  //   add loyaly  and redux
  const addLoyaltyPointsAndCoupons = (data: any) => {
    dispatch(pushLoyaltyPointsAndCoupons(buildLoyaltyPointsAndCouponsUpdate(data)));
  };

  const executeLoyalty = async (phoneDetails: any) => {
    const { phoneNumber, countryCode } = phoneDetails;
    const payload = buildCheckLoyaltyBalancePayload({
      loyaltyPartner: loyaltyPartnerRdx,
      phoneNumber,
      countryCode,
    });

    try {
      const response: any = await executeLoyaltyEvent({
        deployment_id: selectDeploymentDetailsRdx?._id,
        event_name: "check_loyalty_balance",
        partners: buildLoyaltyEventPartners(loyaltyPartnerRdx),
        data: payload,
      });

      const resp = response?.data;
      // const resp = xenoExpectedSuccessResponse;
      addLoyaltyPointsAndCoupons(resp?.response);
      const allLoyaltyItems = getAllLoyaltyItemsFromMenu(
        resp?.response?.coupons,
      );
      dispatch(pushLoyaltyItems(allLoyaltyItems));
      // return {
      //   status_code: 200,
      //   response: xenoExpectedSuccessResponse.response,
      // };
      return resp;
    } catch (error) {
      console.error("Error in executeLoyalty: ", error);
    }
  };

  const validateCoupon = async ({ items, coupon_code: _coupon_code }: any) => {
    const newUuid = uuid();
    const payload = buildValidateCouponPayload({
      loyaltyPartner: loyaltyPartnerRdx,
      phoneNumber,
      transactionId: newUuid,
      items,
    });

    try {
      const response: any = await executeLoyaltyEvent({
        deployment_id: selectDeploymentDetailsRdx?._id,
        event_name: "validate_coupon",
        partners: buildLoyaltyEventPartners(loyaltyPartnerRdx),
        data: payload,
      });

      getAllLoyaltyItemsFromMenu(
        xenoExpectedSuccessResponse.response.coupons,
      );
      const resp = response?.data;
      // return {
      //   status_code: 200,
      //   response: {
      //     points_value: 10,
      //     authentication: true,
      //   },
      // };
      return resp;
    } catch (error) {
      console.error("Error in executeLoyalty: ", error);
    }
  };

  const redeemLoyaltyPoints = async ({ items, totalPoints: _totalPoints }: any) => {
    const newUuid = uuid();
    const payload = buildAuthenticateRedemptionPayload({
      loyaltyPartner: loyaltyPartnerRdx,
      phoneNumber,
      countryCode,
      transactionId: newUuid,
      items,
    });

    try {
      const response: any = await executeLoyaltyEvent({
        deployment_id: selectDeploymentDetailsRdx?._id,
        event_name: "authenticate_redemption",
        partners: buildLoyaltyEventPartners(loyaltyPartnerRdx),
        data: payload,
      });

      getAllLoyaltyItemsFromMenu(
        xenoExpectedSuccessResponse.response.coupons,
      );
      const resp = response?.data;
      // const resp = {
      //   status_code: 200,
      //   response: {
      //     points_value: 10,
      //     authentication: true,
      //   },
      // };
      return resp;
    } catch (error) {
      console.error("Error in executeLoyalty: ", error);
    }
  };

  const finalLoyaltyRedemption = async (
    coupon_code: any,
    otp: any,
    rewardItem?: any,
  ) => {
    const newUuid = uuid();
    const payload = buildRedeemCouponPayload({
      loyaltyPartner: loyaltyPartnerRdx,
      phoneNumber,
      countryCode,
      tabType,
      coupon_code,
      otp,
      rewardItem,
      transactionId: newUuid,
      instanceId: uuid(),
    });
    const response: any = await executeLoyaltyEvent({
      deployment_id: selectDeploymentDetailsRdx?._id,
      event_name: "redeem_coupon",
      partners: buildLoyaltyEventPartners(loyaltyPartnerRdx),
      data: payload,
    });
    // const resp = response?.data;

    const resp = {
      ...response?.data,
      // Built AFTER the redemption response so infoForClaim.datetime is the
      // claim time (it keys the later undoRewardRedemption call).
      infoForClaim: buildInfoForClaim({
        loyaltyPartner: loyaltyPartnerRdx,
        countryCode,
        phoneNumber,
        coupon_code,
        otp,
      }),
    };
    return resp;
  };

  const getAllLoyaltyItemsFromMenu = (coupons: any) => {
    // Verbatim from the pre-extraction implementation; the engine half is
    // console-free, so the log lives here. Output is unchanged.
    console.log("menuData0-0-0", menuData);
    return getAllLoyaltyItemsFromMenuEngine(coupons, menuData);
  };

  const redeemItem = (item: any) => {
    return redeemItemEngine(item);
  };

  const addItemToLoyaltyParking = (item: any) => {
    dispatch(parkRedeemedItem(item));
  };

  const setClaimedCouponToRedux = (data: any) => {
    dispatch(setClaimedCoupon(buildClaimedCouponRecord(data)));
  };

  const removeClaimedCouponFromPersist = () => {
    dispatch(removeClaimedCoupon());
    // FORK PARITY: posistKiosk mirrors the claimed coupon into localStorage;
    // cleanup must hit the same key. Folds into the persistence manifest later.
    // eslint-disable-next-line no-restricted-globals -- fork-parity raw storage site
    localStorage.removeItem("claimedCoupon");
  };

  const checkAndRevokeLoyaltyReward = async () => {
    if (!claimedCouponRdx?.isClaimed) return;
    const uri = `https://xeno.in:2223/api/xeno/loyalty/undoRewardRedemption?apikey=${claimedCouponRdx?.couponData?.merchantId}&phone=${claimedCouponRdx?.couponData?.phoneNumber}&datetime=${claimedCouponRdx?.couponData?.datetime}&pointsToBeReturned=${claimedCouponRdx?.couponData?.claimedPoints}&rewardId=${claimedCouponRdx?.couponData?.couponCode}`;
    const data = await fetch(uri, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    await data.json();
    removeClaimedCouponFromPersist();
  };

  const vaildateLoyaltyIfRedeemedFromLoyalty = (cartItems: any) => {
    return vaildateLoyaltyIfRedeemedFromLoyaltyEngine(cartItems);
  };

  const shouldPlaceLoyaltyOrderDirectly = (args: {
    cartItems: any;
    redeemedLoyalty: { points: number; value: number } | null;
    netAmount: any;
  }): boolean => {
    return shouldPlaceLoyaltyOrderDirectlyEngine(args);
  };

  const redeemLoyaltyPointsForReeloPoints = async ({
    points,
    calculatedBill,
    tabType,
  }: any) => {
    const newUuid = uuid();
    const payload = buildReeloPointsRedemptionPayload({
      loyaltyPartner: loyaltyPartnerRdx,
      phoneNumber,
      countryCode,
      points,
      calculatedBill,
      tabType,
      transactionId: newUuid,
    });

    try {
      const response: any = await executeLoyaltyEvent({
        deployment_id: selectDeploymentDetailsRdx?._id,
        event_name: "authenticate_redemption",
        partners: buildLoyaltyEventPartners(loyaltyPartnerRdx),
        data: payload,
      });

      // On an HTTP error RTK Query returns { error } with the parsed body under
      // error.data — fall back to it so the redemption failure message still
      // reaches the caller instead of a silent undefined.
      const resp = response?.data ?? response?.error?.data;
      // const resp = {
      //   status_code: 200,
      //   response: {
      //     points_value: 10,
      //     authentication: true,
      //   },
      // };
      return resp;
    } catch (error) {
      console.error("Error in executeLoyalty: ", error);
    }
  };

  const enterOtpAndRedeem = async ({
    points,
    calculatedBill,
    tabType,
    otp,
  }: any) => {
    const newUuid = uuid();
    const payload = {
      ...buildReeloPointsRedemptionPayload({
        loyaltyPartner: loyaltyPartnerRdx,
        phoneNumber,
        countryCode,
        points,
        calculatedBill,
        tabType,
        transactionId: newUuid,
      }),
      otp: otp,
    };

    try {
      const response: any = await executeLoyaltyEvent({
        deployment_id: selectDeploymentDetailsRdx?._id,
        event_name: "redeem_points",
        partners: buildLoyaltyEventPartners(loyaltyPartnerRdx),
        data: payload,
      });

      // On an HTTP error RTK Query returns { error } with the parsed body under
      // error.data — fall back to it so the redemption failure message still
      // reaches the caller instead of a silent undefined.
      const resp = response?.data ?? response?.error?.data;
      // const resp = {
      //   status_code: 200,
      //   response: {
      //     points_value: 10,
      //     authentication: true,
      //   },
      // };
      return resp;
    } catch (error) {
      console.error("Error in executeLoyalty: ", error);
    }
  };

  return {
    redeemItem,
    redeemLoyaltyPoints,
    executeLoyalty,
    isLoyaltyEventLoading,
    addItemToLoyaltyParking,
    finalLoyaltyRedemption,
    validateCoupon,
    setClaimedCouponToRedux,
    checkAndRevokeLoyaltyReward,
    removeClaimedCouponFromPersist,
    getAllLoyaltyItemsFromMenu,
    vaildateLoyaltyIfRedeemedFromLoyalty,
    shouldPlaceLoyaltyOrderDirectly,
    redeemLoyaltyPointsForReeloPoints,
    enterOtpAndRedeem,
    resetLoyaltyEvent,
  };
}

export default useLoyalty;
