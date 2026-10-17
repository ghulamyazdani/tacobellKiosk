import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { selectIsLoyaltyIdentified } from "@cx-sdk/ordering/state/loyalty.slice";
import useAppSettings from "./useAppSettings";

/**
 * The checkout steps from the bag to the receipt question, in flow order —
 * the ONE place that decides where a forward tap goes and where BACK returns
 * (user 2026-10-14: "correct redirection of all the back buttons … so that it
 * doesn't break the flow"). A session walks only the steps that apply to it:
 *
 *   /cart          always (the bag's PAY starts checkout)
 *   /tent          a table order type (tab_type "table")
 *   /phone         CRM shown, unless loyalty is on and a rewards login
 *                  identified the guest — the phone is never asked before
 *                  the menu, so a guest who did not log in to rewards is
 *                  asked here, as with loyalty off (user 2026-10-17)
 *   /customerName  CRM shown
 *   /payment       always
 *   /receipt       always — before the push at the counter; a Paytm payment
 *                  reaches it paid, where it has no BACK
 *
 * "CRM shown" is `!skip_crm_page` (settingsEngine.shouldSkipCRM, "hide CRM").
 * These are the bag's own predicates: the SDK's resolveCheckoutRoute picks
 * the step after /cart from the same four inputs, and useCheckoutFlow.test
 * pins the two equal. /paymentPolling and /orderSuccess have no BACK (an
 * order may be placed or paid). `appSettings.skipPhoneAndName` adds or skips
 * nothing — no code sets it.
 */
const STEPS = ["/cart", "/tent", "/phone", "/customerName", "/payment", "/receipt"] as const;

export type CheckoutStep = (typeof STEPS)[number];

/** The settings that add or skip a checkout step. */
export interface CheckoutFlow {
  /** The order type's tab type; "table" adds /tent. */
  tabType: unknown;
  /** skip_crm_page ("hide CRM"): no /phone, no /customerName. */
  skipCRM: unknown;
  /** Loyalty on (getIsLoyaltyOn): with an identified guest, no checkout /phone. */
  isLoyaltyOn: unknown;
  /**
   * A balance lookup answered for the phone in the store (the rewards login —
   * selectIsLoyaltyIdentified): that number is already known.
   */
  isLoyaltyIdentified: boolean;
}

const applies = (
  step: CheckoutStep,
  { tabType, skipCRM, isLoyaltyOn, isLoyaltyIdentified }: CheckoutFlow
) => {
  if (step === "/tent") return tabType === "table";
  if (step === "/phone") return !skipCRM && !(isLoyaltyOn && isLoyaltyIdentified);
  if (step === "/customerName") return !skipCRM;
  return true;
};

/** Where a forward tap on `from` lands: the next step that applies (the last stays). */
export const nextCheckoutStep = (from: CheckoutStep, flow: CheckoutFlow): CheckoutStep =>
  STEPS.slice(STEPS.indexOf(from) + 1).find((step) => applies(step, flow)) ?? from;

/**
 * Where BACK on `from` lands: the step before it that applies — the screen
 * the guest came from, never one this session skipped (the first stays).
 */
export const previousCheckoutStep = (from: CheckoutStep, flow: CheckoutFlow): CheckoutStep =>
  STEPS.slice(0, STEPS.indexOf(from)).reverse().find((step) => applies(step, flow)) ?? from;

/**
 * The steps under this kiosk's settings, navigated. /phone without router
 * state is the legacy pre-menu loyalty lookup, so its checkout leg carries
 * `checkoutRoute: "phone"`, as the bag's PAY does — without it a BACK to
 * /phone would open the pre-menu screen, whose exits are /second and /menu.
 */
export default function useCheckoutFlow() {
  const navigate = useNavigate();
  const { getTabType, shouldSkipCRM, getIsLoyaltyOn } = useAppSettings();
  const isLoyaltyIdentified = useSelector(selectIsLoyaltyIdentified);
  const flow: CheckoutFlow = {
    tabType: getTabType(),
    skipCRM: shouldSkipCRM(),
    isLoyaltyOn: getIsLoyaltyOn(),
    isLoyaltyIdentified,
  };
  const go = (step: CheckoutStep) => {
    if (step === "/phone") navigate(step, { state: { checkoutRoute: "phone" } });
    else navigate(step);
  };
  return {
    goNext: (from: CheckoutStep) => go(nextCheckoutStep(from, flow)),
    goBack: (from: CheckoutStep) => go(previousCheckoutStep(from, flow)),
  };
}
