import { useSelector } from "react-redux";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { getCurrencyText } from "@cx-sdk/catalog/settings/settingsEngine";

/**
 * The deployment's price symbol, for EVERY price on screen (UB1). The backend
 * sends `deployment.currencySettings = { currency: "INR", text: "₹", uniDec,
 * uniHex }` (cx/kiosk/get_data); the SDK reads `text` and falls back to "₹"
 * when it is absent, `[]` or the legacy number 1 — the fork's getCurrency()
 * rule. There is no `symbol` key: reading one printed every price bare.
 * `String()` keeps a malformed `text` out of JSX. ESLint allows
 * `selectCurrency` only here and in useAppSettings.
 *
 * ponytail: India-only — a SAR deployment needs the RiyalLogo element;
 * switch to useAppSettings().getCurrency() if one ever ships.
 */
export default function useCurrencySymbol(): string {
  return String(getCurrencyText(useSelector(selectCurrency)));
}
