import { useDispatch, useStore } from "react-redux";
import { isTimeoutError, withTimeoutRetry } from "@cx-sdk/core";
import {
  useUpdateCxFcmKeyMutation,
  useUpdateCxSoftwareDeviceMutation,
  useUpdateDeviceStatusMutation,
} from "@cx-sdk/devices/updates/services/autoUpdateApi";
import {
  initiateWholeAppUpdate,
  markAsUpdateDone,
  selectDeviceUpdateId,
  selectKioskDeviceVersion,
  selectShouldBrandUpdate,
  setKioskDeviceVersion,
} from "@cx-sdk/devices/updates/autoUpdate.slice";
import { shouldUpdateDeviceVersion } from "@cx-sdk/devices/updates/updatePolicy";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import { reloadTo } from "../../utils/chunkRecovery";

/**
 * Rule 2 for the three background update calls. The transport already aborts
 * every request at 10 s (src/redux/app/apiSlice.ts), so this 10 s is only a
 * backstop; what the wrapper adds is 2 retries (400 ms, then 1.2 s). All
 * three are idempotent device telemetry, so re-sending one that timed out —
 * and may have landed — is harmless; terminal 4xx are not retried.
 * Worst case ≈ 31.6 s: never await one on a customer path.
 */
const TELEMETRY_RETRY = { timeoutMs: 10_000, retries: 2 } as const;

/**
 * One bounded, retried telemetry POST. Resolves true only when the backend
 * took it; NEVER rejects. A failure becomes one ErrorOccurred event carrying
 * the status and `context` only — never the FCM token, a request body or RTK
 * `data`.
 */
const sendTelemetry = async (
  source: "fcm_token_register" | "update_ack" | "version_report",
  call: () => Promise<unknown>,
  context: Record<string, string> = {},
): Promise<boolean> => {
  let error: unknown;
  try {
    const result = await withTimeoutRetry(call, TELEMETRY_RETRY);
    if (result.ok) return true;
    error = result.error;
  } catch (thrown) {
    error = thrown; // withTimeoutRetry never throws; Rule 2 belt and braces
  }
  const e = error as { status?: unknown; name?: unknown } | null | undefined;
  captureKioskEvent(KioskEventName.ErrorOccurred, {
    error_source: source,
    error_status: String(e?.status ?? e?.name ?? "unknown"),
    timed_out: isTimeoutError(error),
    ...context,
  });
  return false;
};

/** FCM tokens and update ids are opaque strings; blank is "none". */
const isNonBlank = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * The kiosk's update plumbing (P9e): FCM token registration, the brand-update
 * ack, the build-version report and the single whole-app reload. Every
 * function is safe to fire and forget — none of them ever rejects.
 */
function useAutoUpdate() {
  const dispatch = useDispatch();
  // State is read at CALL time (useOfferApply precedent): callers run these
  // from timers and effects, where a render snapshot would be stale.
  const store = useStore();
  const [updateCxFcmKey] = useUpdateCxFcmKeyMutation();
  const [updateDeviceStatus] = useUpdateDeviceStatusMutation();
  const [updateCxSoftwareDevice] = useUpdateCxSoftwareDeviceMutation();

  /** Registers a minted FCM token. Empty/blank → false with NO POST (D11). True only when the backend took it. */
  const registerFCMTokenToServer = async (token: string): Promise<boolean> => {
    if (!isNonBlank(token)) return false;
    return sendTelemetry("fcm_token_register", () =>
      updateCxFcmKey({ app: "kiosk", fcm_token: token }).unwrap(),
    );
  };

  /**
   * Acks a PENDING FCM brand update; resolves true when the backend took it.
   * The flag is lowered FIRST — synchronously, before any await — whatever
   * the ack's outcome (D9): a failing ack can never loop the splash refresh,
   * the caller may navigate in the same tick (`void` it, never await it), and
   * a newer push that lands mid-ack keeps its own raised flag. Nothing
   * pending → no POST, so a scheduled or operator refresh never re-acks the
   * stale, never-cleared id.
   */
  const updateDeviceUpdateStatus = async (): Promise<boolean> => {
    const state = store.getState();
    if (!selectShouldBrandUpdate(state)) return false;
    const deviceUpdateId: unknown = selectDeviceUpdateId(state);
    dispatch(markAsUpdateDone());
    if (!isNonBlank(deviceUpdateId)) return false;
    return sendTelemetry(
      "update_ack",
      () =>
        updateDeviceStatus({
          app: "kiosk",
          device_update_id: deviceUpdateId,
        }).unwrap(),
      { device_update_id: deviceUpdateId },
    );
  };

  /**
   * Reports this build's version when it differs from the last one the
   * backend CONFIRMED. Recorded only on success (D8): a failed report is
   * re-sent on the next page load. Never rejects.
   */
  const checkAndUpdateDeviceVersionDeviceWise = async (): Promise<void> => {
    const version = process.env.PACKAGE_VERSION;
    if (
      !version ||
      !shouldUpdateDeviceVersion(
        version,
        selectKioskDeviceVersion(store.getState()),
      )
    ) {
      return;
    }
    const reported = await sendTelemetry(
      "version_report",
      () => updateCxSoftwareDevice({ app: "kiosk", version }).unwrap(),
      { version },
    );
    // ponytail: no mounted guard — the version is device-scoped and every
    // logout path reloads the page; a guard is owed only if one ever doesn't.
    if (reported) dispatch(setKioskDeviceVersion(version));
  };

  /** A new build is installed: the splash applies it at its next dwell. */
  const setAutoUpdateOnNextStartOver = () => {
    dispatch(initiateWholeAppUpdate());
  };

  /** The ONE whole-app reload (P8b: disconnect terminal sockets here, first). Splash only. */
  const applyWholeAppUpdate = () => reloadTo("/start");

  return {
    registerFCMTokenToServer,
    updateDeviceUpdateStatus,
    checkAndUpdateDeviceVersionDeviceWise,
    setAutoUpdateOnNextStartOver,
    applyWholeAppUpdate,
  };
}

export default useAutoUpdate;
