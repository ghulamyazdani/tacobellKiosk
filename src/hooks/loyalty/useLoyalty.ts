/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useLoyalty wrapper (customization vertical
 * port, transitive dep of useCustomization). The anys are inherited; typed in
 * later domain passes. Do not add NEW anys.
 */
// Thin wrapper over the pure loyalty engine (@cx-sdk/ordering/loyalty/loyaltyEngine).
// This hook keeps ONLY the impure edges: redux selectors/dispatches, the RTK
// Query executeLoyaltyEvent transport, uuid generation, failure reports
// (ErrorOccurred — audit-fixes C5), the localStorage claimed-coupon cleanup,
// and the raw Xeno undoRewardRedemption
// fetch (Xeno's own origin, so it stays off the kiosk transport and its
// credentials; bounded, never retried — see checkAndRevokeLoyaltyReward).
// All payload building, coupon/menu matching, discount math and the
// payment-bypass predicate live in the engine.
import { useEffect, useRef } from "react";
import { isTimeoutError } from "@cx-sdk/core/transport/withTimeoutRetry";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import { useExecuteLoyaltyEventMutation } from "@cx-sdk/ordering/services/loyaltyApi";
import { selectLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { useSelector } from "react-redux";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
import { pushLoyaltyPointsAndCoupons } from "@cx-sdk/ordering/state/loyalty.slice";
import { useDispatch } from "react-redux";
import { selectMenu } from "@cx-sdk/catalog/state/Menu.slice";
import { pushLoyaltyItems } from "@cx-sdk/ordering/state/loyalty.slice";
import { setLoyaltyIdentified } from "@cx-sdk/ordering/state/loyalty.slice";
import { parkRedeemedItem } from "@cx-sdk/ordering/state/loyalty.slice";
import { selectCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import { selectPhoneNumber } from "@cx-sdk/core/customer/customerInfo.slice";
import { selectTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { v4 as uuid } from "uuid";
import useOrderHook from "../menuHooks/useOrderHook";
import { useIdleHold } from "../utils/useIdleTimeout";
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

/** Rule 2 budget for the Xeno revoke (undoRewardRedemption). */
const XENO_REVOKE_TIMEOUT_MS = 10_000;

/**
 * Claim (by its datetime) whose undo is in flight. Module scope: BagSheet,
 * Menu, CustomerName and StartScreen each hold their own useLoyalty, and the
 * bag's auto-reversal plus a Cancel order inside its 10 s window would
 * otherwise send two undos for one claim — a double refund unless Xeno
 * dedupes (unconfirmed).
 */
let revokingClaim: string | undefined;

/**
 * A loyalty call that threw: it still resolves undefined (each caller's
 * no-answer path), and is reported — never the phone or a coupon (C5).
 */
const reportLoyaltyFailure = (
  stage:
    | "executeLoyalty"
    | "validateCoupon"
    | "redeemLoyaltyPoints"
    | "redeemLoyaltyPointsForReeloPoints"
    | "enterOtpAndRedeem",
  error: unknown,
) =>
  captureKioskEvent(KioskEventName.ErrorOccurred, {
    error_source: "loyalty",
    stage,
    error_message: error instanceof Error ? error.message : String(error),
  });

function useLoyalty() {
  const [executeLoyaltyEvent, { isLoading: isLoyaltyEventLoading, reset: resetLoyaltyEvent }] =
    useExecuteLoyaltyEventMutation();
  // Lookups and redemptions dispatch customer-scoped (persisted) loyalty
  // state AFTER their await — an idle reset mid-call would let that land in
  // the next customer's session. Every screen using this hook is covered.
  useIdleHold(isLoyaltyEventLoading);
  // The hold ends when the asking screen unmounts, and nothing blocks the
  // exits around a lookup (Back/Skip/Cancel off /phone, closing the login
  // modal). RTK's unmount reset() does not abort, so the trigger still
  // resolves with {data} — executeLoyalty must not write it into whoever is
  // at the kiosk by then (Rule 3).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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
      // undefined, not resp: both callers then take their no-lookup path, so
      // LoyaltyLoginModal cannot open the rewards sheet for the next customer.
      if (!mountedRef.current) return undefined;

      const resp = response?.data;
      // const resp = xenoExpectedSuccessResponse;
      addLoyaltyPointsAndCoupons(resp?.response);
      const allLoyaltyItems = getAllLoyaltyItemsFromMenu(
        resp?.response?.coupons,
      );
      dispatch(pushLoyaltyItems(allLoyaltyItems));
      // The rewards entries and checkout's /phone step key on this (user
      // 2026-10-17): only a 200 identifies the guest. A non-200 leaves them
      // unidentified, so the rewards entry retries and checkout asks for the
      // number again.
      dispatch(setLoyaltyIdentified(resp?.status_code === 200));
      // return {
      //   status_code: 200,
      //   response: xenoExpectedSuccessResponse.response,
      // };
      return resp;
    } catch (error) {
      reportLoyaltyFailure("executeLoyalty", error);
      // A failed transport (no body) or a non-200 without `response` throws
      // in addLoyaltyPointsAndCoupons above, before the flag: the callers
      // read this as a failed lookup, so it identifies no one either.
      if (mountedRef.current) dispatch(setLoyaltyIdentified(false));
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
      reportLoyaltyFailure("validateCoupon", error);
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
      reportLoyaltyFailure("redeemLoyaltyPoints", error);
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
    // A transport failure (timeout, network, HTTP error) resolves with NO
    // body. Wrapping infoForClaim around nothing made
    // getLoyaltyRedemptionError read it as SUCCESS — free reward row + claim
    // + points deducted with no Xeno confirmation. undefined is that
    // parser's missing-body failure, so the sheet shows its error instead.
    if (!response?.data) return undefined;
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

  const getAllLoyaltyItemsFromMenu = (coupons: any) =>
    getAllLoyaltyItemsFromMenuEngine(coupons, menuData);

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
    const claim = claimedCouponRdx?.couponData;
    // User decision 2026-10-01 (P9d S7): a push carrying this claim ended
    // outcome-unknown (usePayAtCounter marks it), so the order — reward
    // included — may exist. Never auto-refund it: hand it to staff through
    // this event (non-PII ids only) and drop the claim so no later caller
    // reports it twice. Every unmarked claim takes the undo below unchanged.
    if (claim?.orderOutcomeUnknown) {
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        source: "xeno_revoke_skipped",
        reason: "order_outcome_unknown",
        reward_id: claim?.couponCode,
        claim_datetime: claim?.datetime,
        points: claim?.claimedPoints,
      });
      removeClaimedCouponFromPersist();
      return;
    }
    const claimKey = String(claim?.datetime);
    if (revokingClaim === claimKey) return;
    revokingClaim = claimKey;
    const uri = `https://xeno.in:2223/api/xeno/loyalty/undoRewardRedemption?apikey=${claimedCouponRdx?.couponData?.merchantId}&phone=${claimedCouponRdx?.couponData?.phoneNumber}&datetime=${claimedCouponRdx?.couponData?.datetime}&pointsToBeReturned=${claimedCouponRdx?.couponData?.claimedPoints}&rewardId=${claimedCouponRdx?.couponData?.couponCode}`;
    try {
      // Rule 2 bound, and NEVER retried: an undo carrying a client-supplied
      // points amount is not known to be idempotent — a timed-out one may
      // have landed, so a resend risks a double refund. The bound also keeps
      // the late removeClaimedCouponFromPersist() below off the next
      // customer's claim (nobody reaches a claimed reward within 10 s).
      const data = await fetch(uri, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(XENO_REVOKE_TIMEOUT_MS),
      });
      await data.json();
    } catch (error) {
      // Claim kept (fork parity) — but only the in-session bag callers get a
      // later teardown; StartScreen/Menu/CustomerName reset straight after,
      // which wipes it. Every caller is fire-and-forget, so this event is the
      // only trace of a stranded refund: it carries the non-PII claim ids to
      // reconcile it (never the phone or the apikey).
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        source: "xeno_revoke",
        timed_out: isTimeoutError(error),
        reward_id: claim?.couponCode,
        claim_datetime: claim?.datetime,
        points: claim?.claimedPoints,
      });
      return;
    } finally {
      revokingClaim = undefined;
    }
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
      reportLoyaltyFailure("redeemLoyaltyPointsForReeloPoints", error);
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
      reportLoyaltyFailure("enterOtpAndRedeem", error);
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
