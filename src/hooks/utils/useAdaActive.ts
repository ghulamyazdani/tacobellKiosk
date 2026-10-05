import { useSelector } from "react-redux";
import {
  selectAccessibilityMode,
  selectEnableAccessbilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";

/**
 * True while the ADA reach-zone view is ON: the guest's toggle
 * (`accessibilityMode`, never persisted) AND the tenant's feature gate
 * (`enableAccessibilityMode`, from get_kiosk_settings). Requiring both means a
 * tenant switching the feature off can never leave a guest stuck in the view.
 * (`selectEnableAccessbilityMode` — the SDK's misspelling is real.)
 *
 * Pages and overlays size themselves from this. ReachZone adds the one extra
 * rule — the boot/attract routes never render inside the zone — which pages
 * need not repeat: those routes never mount them.
 */
export default function useAdaActive(): boolean {
  const mode = Boolean(useSelector(selectAccessibilityMode));
  const enabled = Boolean(useSelector(selectEnableAccessbilityMode));
  return mode && enabled;
}
