import { moduloCalcaledValue } from "@cx-sdk/catalog/settings/settingsEngine";

/**
 * A price's amount as posistKiosk prints it (user decision 2026-10-14: "use
 * same function used in the posistKiosk for formatting the prices" —
 * useAppSettings().moduloCalcaledValue): a whole amount as it is ("100"), a
 * fraction to two decimals ("5.50", "0.50"). The surfaces posistKiosk
 * formats with it use this: menu / suggestion / buy-stage / picker cards,
 * the PDP price, option and size prices, the menu bar's and the added
 * modal's Total. The bag rows, its bill, the PDP's ADD TO BAG and the payment
 * screens keep two decimals (posistKiosk: calculationWrapper / toFixed(2)).
 * Display only. A missing or non-numeric price reads 0, never "null".
 */
export const formatPrice = (value: unknown): string =>
  String(moduloCalcaledValue(Number(value) || 0));
