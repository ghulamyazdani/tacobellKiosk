import { useSelector } from "react-redux";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { getCurrencyText } from "@cx-sdk/catalog/settings/settingsEngine";

/** U+200E LEFT-TO-RIGHT MARK. */
const LRM = "\u200E";
/** A character from an RTL block: Hebrew to Arabic Extended-A, the Hebrew / Arabic presentation forms, the RTL SMP blocks. */
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * The symbol as one LTR unit inside a price (walk 2026-10-14). A symbol with
 * an RTL letter — the Saudi "﷼" (U+FDFC) is bidi class AL — turned the digits
 * after it into Arabic numbers and reordered the run: "﷼100 | 254 Cal"
 * painted as "254 | 100﷼ Cal", and a dir="auto" leaf that starts with a price
 * resolved RTL ("off your order 200.00﷼"). Between two LRMs the symbol keeps
 * its own glyph, the digits stay European and the first strong character is
 * an L. LRMs, not an LRI…PDI isolate: Chromium's dir="auto" (HTML's
 * first-strong rule) does not skip isolates, so an isolated ﷼ still turned
 * those leaves RTL. Inside Arabic copy every value is an FSI isolate
 * (i18n/index.ts), which the LRM resolves LTR — the documented "prices stay
 * LTR isolates". LTR symbols (£ ₹ $) come back byte-identical, and so does a
 * symbol this already anchored.
 */
export function ltrCurrencySymbol(symbol: string): string {
  if (!RTL.test(symbol) || (symbol.startsWith(LRM) && symbol.endsWith(LRM))) return symbol;
  return `${LRM}${symbol}${LRM}`;
}

/**
 * The deployment's price symbol, for EVERY price on screen (UB1). The backend
 * sends `deployment.currencySettings = { currency: "INR", text: "₹", uniDec,
 * uniHex }` (cx/kiosk/get_data); the SDK reads `text` and falls back to "₹"
 * when it is absent, `[]` or the legacy number 1 — the fork's getCurrency()
 * rule. There is no `symbol` key: reading one printed every price bare.
 * `String()` keeps a malformed `text` out of JSX; ltrCurrencySymbol keeps an
 * RTL one (﷼) from reordering its price. ESLint allows `selectCurrency` only
 * here and in useAppSettings.
 *
 * ponytail: the tenant's TEXT symbol — posistKiosk draws its RiyalLogo SVG
 * for a SAR deployment (useAppSettings().getCurrency()); a client question,
 * not wired: every string builder takes this string.
 */
export default function useCurrencySymbol(): string {
  return ltrCurrencySymbol(String(getCurrencyText(useSelector(selectCurrency))));
}
