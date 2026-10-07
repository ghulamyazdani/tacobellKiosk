/**
 * Every lazy UI part, behind ONE dynamic entry: the bag's (BagSheet), the
 * operator Activity Center (ActivityCenter) and the Xeno rewards sheet (Menu
 * mounts it always, so this chunk loads at /menu entry). Another dynamic
 * entry that shares modules with the main entry makes Rolldown split those shared
 * modules into common chunks the entry modulepreloads — a BIGGER boot path
 * (P9f budget, scripts/check-bundle-size.mjs; a separate Activity chunk
 * measured +5 KiB). One entry keeps the shared modules in the main chunk.
 * Add new lazy UI parts here.
 */
export { default as CompleteYourMealRail } from "./CompleteYourMealRail";
export { default as RewardsSheet } from "../offer/RewardsSheet";
export { default as LoyaltyRewardsSheet } from "../loyalty/LoyaltyRewardsSheet";
export { default as FreebiePickerSheet } from "../offer/FreebiePickerSheet";
export { default as BuyStageSheet } from "../offer/BuyStageSheet";
export { default as OfferAppliedCelebration } from "../offer/OfferAppliedCelebration";
export { default as ActivityModal } from "../activity/ActivityModal";
