/**
 * Every lazy UI part, behind ONE dynamic entry: the bag's (BagSheet) and the
 * operator Activity Center (ActivityCenter). Another dynamic entry that
 * shares modules with the main entry makes Rolldown split those shared
 * modules into common chunks the entry modulepreloads — a BIGGER boot path
 * (P9f budget, scripts/check-bundle-size.mjs; a separate Activity chunk
 * measured +5 KiB). One entry keeps the shared modules in the main chunk.
 * Add new lazy UI parts here.
 */
export { default as CompleteYourMealRail } from "./CompleteYourMealRail";
export { default as RewardsSheet } from "../offer/RewardsSheet";
export { default as FreebiePickerSheet } from "../offer/FreebiePickerSheet";
export { default as BuyStageSheet } from "../offer/BuyStageSheet";
export { default as OfferAppliedCelebration } from "../offer/OfferAppliedCelebration";
export { default as ActivityModal } from "../activity/ActivityModal";
export { default as OrderTypeSwitchFlow } from "./OrderTypeSwitchFlow";
export { default as OrderTypeSwitchNotice } from "./OrderTypeSwitchNotice";
export { default as EditHowManyModal } from "./EditHowManyModal";
// The PDP's lazy part too (D7: new PDP surfaces lazy-load through this entry).
export { default as PdpIncompleteWarning } from "../customization/PdpIncompleteWarning";
// …and the PDP split-edit planner (useCustomization takes a handle while the
// numpad's split marker is set — the numpad already loaded this chunk).
export { planSplitEditCommit } from "@cx-sdk/ordering/cart/splitEdit";
