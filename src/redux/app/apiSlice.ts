/**
 * Web-shell transport wiring (P8-prep). The transport itself now lives in
 * @cx-sdk/core (packages/core/src/transport/kioskApi.ts); this module
 * configures it with the web shell's specifics — env-driven baseUrl, cookie
 * token fallback, the P3d session-recovery callbacks, the Rule 2 request
 * budgets (P9b) and the D2 telemetry / D3 Paytm recovery exemptions (P9e,
 * P8b) — at MODULE
 * SCOPE, so every consumer that imports { apiSlice } through this path gets a
 * configured transport by construction.
 */
import { Cookies } from "react-cookie";
import {
  apiSlice,
  configureKioskTransport,
} from "@cx-sdk/core/transport/kioskApi";
import type { autoUpdateApi } from "@cx-sdk/devices/updates/services/autoUpdateApi";
import {
  recoverFromAuthFailure,
  recoverFromServerError,
} from "./sessionRecovery";

const cookies = new Cookies();

export const baseUrl = import.meta.env.VITE_API_ENDPOINT;

/**
 * Rule 2 (user decision 2026-10-01): every request aborts after 10 s instead
 * of freezing the screen on a hung network. RTK 2.12 bounds the WHOLE request
 * (headers and body); classify the failure with `isTimeoutError`. An
 * endpoint's own FetchArgs `timeout` (the SDK payment polls) still wins.
 */
export const KIOSK_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The one sanctioned exception to Rule 2's 10 s cap (same decision): the
 * full-menu download is a multi-MB payload (reference menu ~7.5 MB, ~90%
 * modifiers), downloaded only on first load or a menu change. Calibration
 * knob: 30 s needs ~2 Mbps effective for that size uncompressed.
 */
export const MENU_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * D2 (user decision 2026-10-05): background update telemetry never tears the
 * session down. A 401 / 504 / 505 on these says nothing about the device
 * session — before this, a gateway 504 on a version report de-registered the
 * kiosk. The caller still gets the error. Keyed by RTK endpoint NAME, like
 * endpointTimeoutsMs; `satisfies` fails the type-check if one is renamed in
 * @cx-sdk/devices/updates/services/autoUpdateApi. Every other endpoint still
 * recovers.
 */
export const BACKGROUND_TELEMETRY_ENDPOINTS = [
  "updateCxFcmKey", //         POST /api/cx/update_cx_fcm_key
  "updateCxSoftwareDevice", // POST /api/cx/update_cx_software
  "updateDeviceStatus", //     POST /api/cx/update_device_status
] as const satisfies readonly (keyof typeof autoUpdateApi.endpoints)[];

/**
 * D3 (P8b): the five cx kiosk Paytm calls never tear the session down either.
 * A 401 / 504 / 505 there arrives mid-payment, while a terminal may be armed
 * or a QR live: recovery would log the kiosk out under a paying customer. The
 * caller still gets the error and settles by status. Same name-keyed
 * mechanism as D2, but @cx-sdk/payments/services/paymentSettingsFetchApi is
 * typed `any`, so `satisfies` cannot guard a rename — transportTimeout.test
 * checks each name against the live endpoints instead. Their own FetchArgs
 * timeouts (initiate / void 10 s, status 5 s) already bound them.
 */
export const PAYMENT_GATEWAY_ENDPOINTS = [
  "initiatePaytmDqrKiosk", //    POST /api/cx/kiosk/paytmDynamicQR/createQR
  "checkPaytmDqrKioskStatus", // POST /api/cx/kiosk/paytmDynamicQR/checkStatus
  "initiatePaytmEdcKiosk", //    POST /api/cx/kiosk/paytmEDC/initiate
  "checkPaytmEdcKioskStatus", // POST /api/cx/kiosk/paytmEDC/checkStatus
  "cancelPaytmEdcKiosk", //      POST /api/cx/kiosk/paytmEDC/cancel
] as const;

/** Every endpoint whose 401 / 504 / 505 skips the session recovery. */
export const RECOVERY_EXEMPT_ENDPOINTS = [
  ...BACKGROUND_TELEMETRY_ENDPOINTS,
  ...PAYMENT_GATEWAY_ENDPOINTS,
] as const;

configureKioskTransport({
  baseUrl,
  tokenFallback: () => cookies.get("token"),
  onAuthFailure: recoverFromAuthFailure,
  onServerError: recoverFromServerError,
  requestTimeoutMs: KIOSK_REQUEST_TIMEOUT_MS,
  // Keyed by RTK endpoint name (@cx-sdk/catalog/services/menuApi `getMenu`).
  endpointTimeoutsMs: { getMenu: MENU_DOWNLOAD_TIMEOUT_MS },
  recoveryExemptEndpoints: RECOVERY_EXEMPT_ENDPOINTS,
});

export { apiSlice };
