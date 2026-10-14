import { moduloCalcaledValue } from "@cx-sdk/catalog/settings/settingsEngine";

/**
 * A price's amount as posistKiosk prints it (user decision 2026-10-14: "use
 * same function used in the posistKiosk for formatting the prices" —
 * useAppSettings().moduloCalcaledValue): a whole amount as it is ("100"), a
 * fraction to two decimals ("5.50", "0.50"). The surfaces posistKiosk
 * formats with it use this: menu / suggestion / buy-stage / picker cards,
 * the PDP price, option and size prices, the menu bar's and the added
 * modal's Total, and every reward figure — the rewards rows and their
 * descriptions, nudges, the removal notice, the picker's "off", the
 * celebration, the bag's applied-reward row, the meal's Save pill
 * (OffersSheet / SavingsLine amt(), OfferRemovalModal, OfferItem). The bag
 * rows (a row's "off" badge too), its bill (Discounts too), the PDP's ADD TO
 * BAG and the payment screens keep two decimals (posistKiosk: CartItem /
 * PriceDetails calculationWrapper, toFixed(2)). Display only. A missing or
 * non-numeric price reads 0, never "null".
 */
export const formatPrice = (value: unknown): string =>
  String(moduloCalcaledValue(Number(value) || 0));
