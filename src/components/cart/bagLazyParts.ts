/**
 * Every lazy part of the bag, behind ONE dynamic entry (BagSheet). Two
 * dynamic entries that share modules with the main entry make Rolldown
 * split those shared modules into a common chunk the entry modulepreloads —
 * a BIGGER boot path (P9f budget, scripts/check-bundle-size.mjs). One entry
 * keeps the shared modules in the main chunk. Add new lazy bag parts here.
 */
export { default as CompleteYourMealRail } from "./CompleteYourMealRail";
export { default as BuyStageSheet } from "../offer/BuyStageSheet";
export { default as OfferAppliedCelebration } from "../offer/OfferAppliedCelebration";
