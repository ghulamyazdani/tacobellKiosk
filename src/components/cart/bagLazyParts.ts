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
export { default as OrderTypeSwitchFlow } from "./OrderTypeSwitchFlow";
export { default as OrderTypeSwitchNotice } from "./OrderTypeSwitchNotice";
export { default as EditHowManyModal } from "./EditHowManyModal";
// The PDP's lazy part too (D7: new PDP surfaces lazy-load through this entry).
export { default as PdpIncompleteWarning } from "../customization/PdpIncompleteWarning";
// …and the PDP split-edit planner (useCustomization takes a handle while the
// numpad's split marker is set — the numpad already loaded this chunk).
export { planSplitEditCommit } from "@cx-sdk/ordering/cart/splitEdit";
