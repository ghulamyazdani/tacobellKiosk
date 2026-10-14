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
export { default as OrderTypeSwitchFlow } from "./OrderTypeSwitchFlow";
export { default as OrderTypeSwitchNotice } from "./OrderTypeSwitchNotice";
export { default as EditHowManyModal } from "./EditHowManyModal";
// The PDP's lazy part too (D7: new PDP surfaces lazy-load through this entry).
export { default as PdpIncompleteWarning } from "../customization/PdpIncompleteWarning";
// …and the PDP split-edit planner (the PDP hands it into useCustomization
// from loadPdpLazyParts — the numpad that starts a split edit already loaded
// this chunk; the hook itself must not import it: the tier-2 page below uses
// the hook, a dependency cycle).
export { planSplitEditCommit } from "@cx-sdk/ordering/cart/splitEdit";
// …and the tier-2 CUSTOMIZE page (+ its private SDK tier2Logic): the PDP
// mounts it only while MIAMTier2Open (loadPdpLazyParts, a scrim until then).
export { default as Tier2CustomizationSheet } from "../customization/Tier2CustomizationSheet";
// UB5: the country picker of /phone and the rewards-login modal.
export { default as CountryPickerSheet } from "../phone/CountryPickerSheet";
// audit-fixes A1: PAY's stock re-check (+ the 838-line OOS engine it runs) —
// loaded at PAY by BagSheet.handlePay, never from a boot module.
export { runCheckoutStockSweep, sameCartRows } from "@cx-sdk/catalog/oos/checkoutStockSweep";
// walk-oos: the sweep's write-back (a dropped pick kept, flagged) and the
// names its notice gives — PAY only.
export { planStockWrite, soldOutNames } from "./payStock";
// audit-fixes U3: the bag's cooking-instructions sheet.
export { default as InstructionsSheet } from "./InstructionsSheet";
